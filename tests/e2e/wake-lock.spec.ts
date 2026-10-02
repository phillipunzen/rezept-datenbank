import {test,expect} from "@playwright/test";
import {emptyRecipe} from "../../shared/recipes";
test("wake lock handles denial, reactivation and cleanup",async({page})=>{
 await page.addInitScript(()=>{
  const state={requests:0,releases:0,deny:false,release:async()=>{}};
  Object.defineProperty(window,"isSecureContext",{value:true,configurable:true});
  Object.defineProperty(navigator,"wakeLock",{value:{request:async()=>{
   state.requests++;
   if(state.deny) throw new DOMException("Denied","NotAllowedError");
   class Sentinel extends EventTarget {released=false;type="screen";async release(){if(this.released)return;this.released=true;state.releases++;this.dispatchEvent(new Event("release"));}}
   const sentinel=new Sentinel();state.release=()=>sentinel.release();return sentinel;
  }},configurable:true});
  Object.assign(window,{wakeTest:state});
 });
 await page.goto("/");
 await page.getByLabel("E-Mail-Adresse",{exact:true}).fill("browser@example.test");
 await page.getByLabel("Passwort",{exact:true}).fill("browser-test-password-long");
 await page.getByRole("button",{name:"Anmelden",exact:true}).click();
 await expect(page.getByRole("heading",{name:"Your recipes",exact:true})).toBeVisible();
 const recipe=await page.evaluate(async draft=>{
  const householdId=(await (await fetch("/api/v1/households")).json()).households[0].household.id;
  return (await (await fetch("/api/v1/recipes",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...draft,householdId})})).json()).recipe;
 },{...emptyRecipe(""),title:"Wake test",ingredients:[{name:"Rice",amount:null,unit:"",group:"",note:""}],steps:[{instruction:"Cook",durationSeconds:null}]});
 await page.reload();
 await page.getByRole("button",{name:/Wake test/}).click();
 await page.getByRole("button",{name:"Start cooking",exact:true}).click();
 const dialog=page.getByRole("dialog",{name:"Cooking mode",exact:true});
 await expect(dialog.getByText("Screen stays awake",{exact:true})).toBeVisible();
 await page.evaluate(async()=>{
  const w=window as unknown as {wakeTest:{release:()=>Promise<void>}};
  await w.wakeTest.release();
 });
 await expect(dialog.getByText("Screen wake lock inactive",{exact:true})).toBeVisible();
 await page.evaluate(()=>document.dispatchEvent(new Event("visibilitychange")));
 await expect(dialog.getByText("Screen stays awake",{exact:true})).toBeVisible();
 await dialog.getByLabel("Keep screen awake",{exact:true}).uncheck();
 await expect.poll(()=>page.evaluate(()=>(window as unknown as {wakeTest:{releases:number}}).wakeTest.releases)).toBe(2);
 await page.evaluate(()=>(window as unknown as {wakeTest:{deny:boolean}}).wakeTest.deny=true);
 await dialog.getByLabel("Keep screen awake",{exact:true}).check();
 await expect(dialog.getByText("The browser did not allow the screen wake lock.",{exact:true})).toBeVisible();
 await dialog.getByLabel("Keep screen awake",{exact:true}).uncheck();
 await page.evaluate(()=>(window as unknown as {wakeTest:{deny:boolean}}).wakeTest.deny=false);
 await dialog.getByLabel("Keep screen awake",{exact:true}).check();
 await expect(dialog.getByText("Screen stays awake",{exact:true})).toBeVisible();
 await dialog.getByRole("button",{name:"Close cooking mode",exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as unknown as {wakeTest:{releases:number}}).wakeTest.releases)).toBe(3);
 expect(await page.evaluate(async recipe=>(await fetch(`/api/v1/recipes/${recipe.id}?revision=${recipe.revision}`,{method:"DELETE"})).ok,recipe)).toBe(true);
});
