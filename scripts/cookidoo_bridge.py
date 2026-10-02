"""Small stdin/stdout adapter around cookidoo-api's published Python interface.
No HTTP listener, passwords on argv, or persistent Python session storage.
"""
import asyncio, dataclasses, json, logging, sys
sys.path.insert(0, '/opt/cookidoo-sdk')
from aiohttp import ClientSession, ClientTimeout, CookieJar
from cookidoo_api import Cookidoo, CookidooConfig, CookidooLocalizationConfig, CookidooAuthData, CookidooAdditionalItem, CookidooIngredientItem, CookidooAuthException
logging.disable(logging.CRITICAL)
MARKETS={'de':('de-DE','https://cookidoo.de/foundation/de-DE'),'at':('de-AT','https://cookidoo.at/foundation/de-AT'),'ch':('de-CH','https://cookidoo.ch/foundation/de-CH'),'gb':('en-GB','https://cookidoo.co.uk/foundation/en-GB')}
def ingredient(item):return {'key':'ingredient:'+item.id,'kind':'ingredient','id':item.id,'name':item.name,'description':item.description,'preparation':getattr(item,'preparation',None) or '', 'checked':item.is_owned}
def additional(item):return {'key':'additional:'+item.id,'kind':'additional','id':item.id,'name':item.name,'description':'','preparation':'','checked':item.is_owned}
async def snapshot(client):
    values=[*[ingredient(x) for x in await client.get_ingredient_items()],*[additional(x) for x in await client.get_additional_items()]]
    if len(values)>1000:raise ValueError('limit')
    unique={}
    for value in values:
        if len(value['key'])>255 or len(value['name'])>500 or len(value['description'])>500 or len(value['preparation'])>500:raise ValueError('limit')
        if value['key'] in unique and unique[value['key']]!=value:raise ValueError('ambiguous')
        unique[value['key']]=value
    return list(unique.values())
async def execute(request):
    region=request.get('market','de')
    if region not in MARKETS:raise ValueError('market')
    language,url=MARKETS[region]
    cfg=CookidooConfig(localization=CookidooLocalizationConfig(country_code=region,language=language,url=url),email=request.get('email',''),password=request.get('password',''))
    client=None
    async with ClientSession(timeout=ClientTimeout(total=20),cookie_jar=CookieJar(unsafe=True)) as session:
        client=Cookidoo(session,cfg=cfg)
        try:
            if request['operation']=='login':await client.login()
            else:client.apply_auth_data(CookidooAuthData(**request['tokens']))
            values=await snapshot(client)
            results=[]
            if request['operation']=='apply':
                action=request['action'];kind=action['type'];expected=action.get('expected');current=next((v for v in values if v['key']==action.get('remoteKey')),None)
                # Recheck immediately before writing; the upstream API has no atomic ETag contract.
                if expected is not None and current!=expected:return {'ok':False,'code':'CONFLICT','items':values,'tokens':dataclasses.asdict(client.auth_data)}
                if kind=='create':
                    created=await client.add_additional_items([action['name']])
                    if len(created)!=1:raise ValueError('ambiguous')
                    item=created[0]
                    if action['checked']:
                        item.is_owned=True
                        await client.edit_additional_items_ownership([item])
                    results=[additional(item)]
                elif kind=='update':
                    if current is None:raise ValueError('missing')
                    if current['kind']=='additional':
                        item=CookidooAdditionalItem(id=current['id'],name=action['name'],is_owned=action['checked'])
                        if current['name']!=item.name:await client.edit_additional_items([item])
                        if current['checked']!=item.is_owned:await client.edit_additional_items_ownership([item])
                    else:
                        if action['name']!=current['name']:raise ValueError('ingredient immutable')
                        item=CookidooIngredientItem(id=current['id'],name=current['name'],is_owned=action['checked'],description=current['description'])
                        await client.edit_ingredient_items_ownership([item])
                elif kind=='delete':
                    if current is not None:
                        if current['kind']!='additional':raise ValueError('ingredient immutable')
                        await client.remove_additional_items([current['id']])
                else:raise ValueError('operation')
                values=await snapshot(client)
            return {'ok':True,'items':values,'created':results,'tokens':dataclasses.asdict(client.auth_data)}
        except CookidooAuthException:
            return {'ok':False,'code':'AUTH','tokens':dataclasses.asdict(client.auth_data) if client.auth_data else None}
        except Exception:
            return {'ok':False,'code':'UNAVAILABLE','tokens':dataclasses.asdict(client.auth_data) if client.auth_data else None}
def main():
    try:
        raw=sys.stdin.buffer.read(1024*1024+1)
        if len(raw)>1024*1024:raise ValueError('limit')
        request=json.loads(raw)
        result=asyncio.run(asyncio.wait_for(execute(request),timeout=35))
        encoded=json.dumps(result,separators=(',',':'))
        if len(encoded)>2*1024*1024:raise ValueError('limit')
        sys.stdout.write(encoded)
    except Exception:
        sys.stdout.write(json.dumps({'ok':False,'code':'UNAVAILABLE'}))
if __name__=='__main__':main()
