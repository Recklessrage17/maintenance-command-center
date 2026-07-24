import {expect,type Page,test} from '@playwright/test';

const owner={id:1,fullName:'Owner Admin',email:'owner@example.com',role:'Admin',isOwnerAdmin:true,forcePasswordChange:false,disabled:false,lastLoginAt:null,canDisable:false,canDelete:false};
const created={id:2,fullName:'Created User',email:'created@example.com',role:'Maintenance Tech 2',isOwnerAdmin:false,forcePasswordChange:true,disabled:false,lastLoginAt:null,canDisable:true,canDelete:true};

async function mockUsers(page:Page,options:{postDelay?:number;passwordError?:boolean}={}){
  let users=[owner];
  let postCount=0;
  let getCount=0;
  const postedBodies:Record<string,unknown>[]=[];
  await page.route('**/api/auth/status',route=>route.fulfill({json:{setupRequired:false,user:owner}}));
  await page.route(/\/api\/users(?:\?.*)?$/,async route=>{
    if(route.request().method()==='GET'){
      getCount+=1;
      return route.fulfill({json:{users}});
    }
    if(route.request().method()==='POST'){
      postCount+=1;
      postedBodies.push(route.request().postDataJSON());
      if(options.postDelay) await new Promise(resolve=>setTimeout(resolve,options.postDelay));
      if(options.passwordError) return route.fulfill({status:400,json:{error:'Temporary password must be at least 10 characters and include an uppercase letter, lowercase letter, number, and symbol.',code:'PASSWORD_COMPLEXITY',field:'temporaryPassword',requirements:{minLength:10,uppercase:true,lowercase:true,number:true,symbol:true}}});
      users=[owner,created];
      return route.fulfill({status:201,json:{user:created}});
    }
    return route.fulfill({status:405,json:{error:'Method not allowed.'}});
  });
  return {postCount:()=>postCount,getCount:()=>getCount,postedBodies};
}

async function assertNoHorizontalOverflow(page:Page){
  const dimensions=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client);
}

test('temporary password checklist updates live and Show/Hide, Generate, and Copy remain safe and accessible',async({page})=>{
  await mockUsers(page);
  const consoleMessages:string[]=[];
  page.on('console',message=>consoleMessages.push(message.text()));
  await page.goto('/users');
  const password=page.getByRole('textbox',{name:'Temporary password',exact:true});
  const requirements=page.getByRole('list',{name:'Temporary password requirements'});
  await expect(requirements.getByText('Not met',{exact:true})).toHaveCount(5);
  await password.fill('abcdefghij');
  await expect(requirements.getByText('Met',{exact:true})).toHaveCount(2);
  await password.fill('Abcdefghij');
  await expect(requirements.getByText('Met',{exact:true})).toHaveCount(3);
  await password.fill('Abcdefghi1');
  await expect(requirements.getByText('Met',{exact:true})).toHaveCount(4);
  await password.fill('Abcdefgh1!');
  await expect(requirements.getByText('Met',{exact:true})).toHaveCount(5);

  const visibility=page.getByRole('button',{name:'Show temporary password'});
  await expect(visibility).toHaveAttribute('type','button');
  await visibility.focus();
  await page.keyboard.press('Enter');
  await expect(password).toHaveAttribute('type','text');
  await expect(password).toHaveValue('Abcdefgh1!');
  await expect(page.getByRole('button',{name:'Hide temporary password'})).toBeVisible();
  await page.getByRole('button',{name:'Hide temporary password'}).click();
  await expect(password).toHaveAttribute('type','password');
  await expect(password).toHaveValue('Abcdefgh1!');

  const generatedPasswords=new Set<string>();
  for(let index=0;index<25;index+=1){
    await page.getByRole('button',{name:'Generate Password'}).click();
    const generated=await password.inputValue();
    generatedPasswords.add(generated);
    expect(generated.length).toBeGreaterThanOrEqual(14);
    expect(generated).toMatch(/[A-Z]/);
    expect(generated).toMatch(/[a-z]/);
    expect(generated).toMatch(/\d/);
    expect(generated).toMatch(/[^A-Za-z0-9]/);
  }
  expect(generatedPasswords.size).toBeGreaterThan(20);
  const currentPassword=await password.inputValue();
  await expect(page.getByRole('button',{name:'Copy Password'})).toBeEnabled();
  await page.getByRole('button',{name:'Copy Password'}).click();
  await expect(page.getByRole('status')).toContainText(/Password copied|Could not copy password/);
  expect(page.url()).not.toContain(currentPassword);
  expect(consoleMessages.join('\n')).not.toContain(currentPassword);
  await assertNoHorizontalOverflow(page);
});

test('frontend validation focuses the first invalid field and shows field-specific errors without posting',async({page})=>{
  const api=await mockUsers(page);
  await page.goto('/users');
  await page.getByRole('button',{name:'Create User'}).click();
  await expect(page.getByLabel('Full name')).toBeFocused();
  await expect(page.getByText('Full name is required.')).toBeVisible();
  await expect(page.getByText('Email is required.')).toBeVisible();
  await expect(page.getByText('Temporary password must meet every requirement.')).toBeVisible();
  expect(api.postCount()).toBe(0);

  await page.getByLabel('Full name').fill('Test User');
  await page.getByLabel('Email').fill('invalid-email');
  await page.getByRole('button',{name:'Create User'}).click();
  await expect(page.getByLabel('Email')).toBeFocused();
  await expect(page.getByText('Enter a valid email address.')).toBeVisible();
  await page.getByLabel('Email').fill('test@example.com');
  await page.getByRole('button',{name:'Create User'}).click();
  await expect(page.getByRole('textbox',{name:'Temporary password',exact:true})).toBeFocused();
  expect(api.postCount()).toBe(0);
  await assertNoHorizontalOverflow(page);
});

test('valid creation blocks duplicate submission, refreshes users, clears secrets, and preserves Owner Admin protection',async({page})=>{
  const api=await mockUsers(page,{postDelay:150});
  await page.goto('/users');
  await page.getByLabel('Full name').fill('Created User');
  await page.getByLabel('Email').fill('created@example.com');
  await page.getByLabel('Role / rank').selectOption('Maintenance Tech 2');
  await page.getByRole('textbox',{name:'Temporary password',exact:true}).fill('Valid-Temporary!9');
  await page.locator('.user-create-form').evaluate((form:HTMLFormElement)=>{form.requestSubmit();form.requestSubmit();});
  await expect(page.getByRole('button',{name:'Creating User…'})).toBeDisabled();
  await expect(page.getByText('User created successfully')).toBeVisible();
  expect(api.postCount()).toBe(1);
  expect(api.getCount()).toBe(2);
  expect(api.postedBodies[0]).toEqual({fullName:'Created User',email:'created@example.com',role:'Maintenance Tech 2',temporaryPassword:'Valid-Temporary!9'});
  await expect(page.getByLabel('Full name')).toHaveValue('');
  await expect(page.getByLabel('Email')).toHaveValue('');
  await expect(page.getByRole('textbox',{name:'Temporary password',exact:true})).toHaveValue('');
  await expect(page.getByRole('textbox',{name:'Temporary password',exact:true})).toHaveAttribute('type','password');
  await expect(page.locator('tbody')).toContainText('Created User');
  const ownerRow=page.locator('tbody tr').filter({hasText:'Owner Admin'});
  await expect(ownerRow).toContainText('Protected');
  await expect(ownerRow.getByRole('button',{name:/Disable|Delete/})).toHaveCount(0);
  await assertNoHorizontalOverflow(page);
});

test('structured backend password errors attach to and focus the password field',async({page})=>{
  const api=await mockUsers(page,{passwordError:true});
  await page.goto('/users');
  await page.getByLabel('Full name').fill('Race Condition User');
  await page.getByLabel('Email').fill('race@example.com');
  await page.getByRole('textbox',{name:'Temporary password',exact:true}).fill('Valid-Temporary!9');
  await page.getByRole('button',{name:'Create User'}).click();
  await expect(page.getByRole('textbox',{name:'Temporary password',exact:true})).toBeFocused();
  await expect(page.locator('#temporary-password-error')).toHaveText('Temporary password must be at least 10 characters and include an uppercase letter, lowercase letter, number, and symbol.');
  expect(api.postCount()).toBe(1);
  await expect(page.getByRole('textbox',{name:'Temporary password',exact:true})).toHaveValue('Valid-Temporary!9');
  await assertNoHorizontalOverflow(page);
});
