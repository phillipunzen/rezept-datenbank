"""Offline contract checks against the installed, pinned published SDK."""
import asyncio, dataclasses, importlib.util, pathlib, unittest
spec=importlib.util.spec_from_file_location('bridge',pathlib.Path(__file__).parents[1]/'scripts/cookidoo_bridge.py')
bridge=importlib.util.module_from_spec(spec);spec.loader.exec_module(bridge)
class Fake:
    calls=[]
    extra=[]
    ingredients=[]
    def __init__(self,session,cfg):
        self.cfg=cfg;self.auth_data=bridge.CookidooAuthData(access_token='access',refresh_token='refresh',expires_at=2000000000)
    def apply_auth_data(self,tokens):self.auth_data=tokens
    async def login(self):Fake.calls.append('login')
    async def get_ingredient_items(self):return Fake.ingredients
    async def get_additional_items(self):return Fake.extra
    async def add_additional_items(self,names):
        Fake.calls.append(('create',names));item=bridge.CookidooAdditionalItem(id='new',name=names[0],is_owned=False);Fake.extra.append(item);return [item]
    async def edit_additional_items(self,items):Fake.calls.append(('rename',items[0].name));Fake.extra[0].name=items[0].name
    async def edit_additional_items_ownership(self,items):Fake.calls.append(('check-additional',items[0].is_owned));Fake.extra[0].is_owned=items[0].is_owned
    async def remove_additional_items(self,ids):Fake.calls.append(('remove',ids));Fake.extra[:]=[i for i in Fake.extra if i.id not in ids]
    async def edit_ingredient_items_ownership(self,items):Fake.calls.append(('check-ingredient',items[0].is_owned));Fake.ingredients[0].is_owned=items[0].is_owned
class Contract(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.real=bridge.Cookidoo;bridge.Cookidoo=Fake;Fake.calls=[];Fake.extra=[];Fake.ingredients=[bridge.CookidooIngredientItem(id='salt',name='Salz',is_owned=False,description='1 TL')]
        self.request={'operation':'read','market':'de','tokens':dataclasses.asdict(bridge.CookidooAuthData(access_token='access',refresh_token='refresh',expires_at=2000000000))}
    def tearDown(self):bridge.Cookidoo=self.real
    async def test_sdk_public_contract_and_full_additional_workflow(self):
        for name in ['login','apply_auth_data','get_ingredient_items','get_additional_items','add_additional_items','edit_additional_items','edit_additional_items_ownership','remove_additional_items','edit_ingredient_items_ownership']:self.assertTrue(callable(getattr(self.real,name)))
        r=await bridge.execute(self.request);self.assertEqual(r['items'][0]['key'],'ingredient:salt')
        r=await bridge.execute({**self.request,'operation':'apply','action':{'type':'create','name':'2 Stück Eier','checked':True}});self.assertTrue(r['ok']);self.assertTrue(r['created'][0]['checked']);item=r['created'][0]
        r=await bridge.execute({**self.request,'operation':'apply','action':{'type':'update','remoteKey':item['key'],'expected':item,'name':'3 Stück Eier','checked':False}});self.assertTrue(r['ok']);item=r['items'][1];self.assertEqual(item['name'],'3 Stück Eier');self.assertFalse(item['checked'])
        r=await bridge.execute({**self.request,'operation':'apply','action':{'type':'delete','remoteKey':item['key'],'expected':item}});self.assertTrue(r['ok']);self.assertEqual(len(r['items']),1)
    async def test_recipe_ownership_and_preconditions(self):
        item=(await bridge.execute(self.request))['items'][0]
        r=await bridge.execute({**self.request,'operation':'apply','action':{'type':'update','remoteKey':item['key'],'expected':{**item,'checked':True},'name':item['name'],'checked':True}});self.assertEqual(r['code'],'CONFLICT');self.assertEqual(Fake.calls,[])
        r=await bridge.execute({**self.request,'operation':'apply','action':{'type':'update','remoteKey':item['key'],'expected':item,'name':item['name'],'checked':True}});self.assertTrue(r['ok']);self.assertEqual(Fake.calls,[('check-ingredient',True)])
        item=r['items'][0];r=await bridge.execute({**self.request,'operation':'apply','action':{'type':'delete','remoteKey':item['key'],'expected':item}});self.assertFalse(r['ok']);self.assertEqual(len(Fake.ingredients),1)
        r=await bridge.execute({**self.request,'operation':'apply','action':{'type':'update','remoteKey':item['key'],'expected':item,'name':'Andere Zutat','checked':True}});self.assertFalse(r['ok']);self.assertEqual(Fake.ingredients[0].name,'Salz')
    async def test_fixed_regions_and_duplicate_id_guard(self):
        with self.assertRaises(ValueError):await bridge.execute({**self.request,'market':'https://attacker.invalid'})
        Fake.ingredients.append(bridge.CookidooIngredientItem(id='salt',name='Different',is_owned=False,description=''));r=await bridge.execute(self.request);self.assertFalse(r['ok'])
if __name__=='__main__':unittest.main()
