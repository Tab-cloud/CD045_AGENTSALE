import { randomUUID, randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { sql } from 'drizzle-orm';
import type { Repository } from '@agentsale/database';
import { DomainError } from '@agentsale/domain';
import type { User } from './types';
const scrypt=promisify(scryptCallback);
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
async function encode(password:string){const salt=randomBytes(16).toString('hex');return salt+':'+(await scrypt(password,salt,64) as Buffer).toString('hex');}
async function verify(password:string,encoded:string){const [salt,hash]=encoded.split(':');const actual=await scrypt(password,salt,64) as Buffer;return hash.length===128&&timingSafeEqual(actual,Buffer.from(hash,'hex'));}
const publicUser=(u:Record<string,unknown>):User=>({id:String(u.id),username:String(u.username),role:u.role as User['role'],enabled:Boolean(u.enabled)});
export function createAuth(repo:Repository,workspace:string){
  async function setupNeeded(){return repo.scoped(workspace,async tx=>(await tx.execute(sql`SELECT id FROM app_users LIMIT 1`)).rows.length===0);}
  async function create(username:string,password:string,role:User['role'],actor?:User){
    if(!/^[A-Za-z0-9_-]{3,40}$/.test(username)||password.length<10||password.length>128)throw new DomainError('ACCOUNT_INVALID','账号需为 3–40 位字母数字，密码需为 10–128 位');
    if(actor&&actor.role!=='admin')throw new DomainError('FORBIDDEN','仅管理员可管理账号',403);
    const hash=await encode(password),id=randomUUID();
    return repo.scoped(workspace,async tx=>{
      await tx.execute(sql`SELECT pg_advisory_xact_lock(450201)`);
      if(!actor&&(await tx.execute(sql`SELECT id FROM app_users LIMIT 1`)).rows.length)throw new DomainError('SETUP_COMPLETE','管理员已建立，请登录',409);
      if((await tx.execute(sql`SELECT id FROM app_users WHERE username=${username}`)).rows.length)throw new DomainError('USER_EXISTS','账号已存在',409);
      const user={id,username,role:actor?role:'admin' as const,enabled:true};
      await tx.execute(sql`INSERT INTO app_users(id,workspace_id,username,password_hash,role) VALUES(${id},${workspace},${username},${hash},${user.role})`);
      await tx.execute(sql`INSERT INTO audit(id,workspace_id,action,object_id,summary,created_at) VALUES(${randomUUID()},${workspace},'account.create',${id},${'已建立账号 '+username},${new Date().toISOString()})`);
      return user;
    });
  }
  async function login(username:string,password:string){
    if(username.length>40||password.length>128)throw new DomainError('LOGIN_FAILED','账号或密码不正确',401);
    const user=await repo.scoped(workspace,async tx=>(await tx.execute(sql`SELECT * FROM app_users WHERE username=${username}`)).rows[0]);
    if(!user||!user.enabled||String(user.locked_until)>new Date().toISOString()){
      await scrypt(password,'agentsale-dummy-salt',64);
      throw new DomainError('LOGIN_FAILED','账号或密码不正确，或暂时锁定',401);
    }
    if(!await verify(password,String(user.password_hash))){
      await repo.scoped(workspace,async tx=>{await tx.execute(sql`UPDATE app_users SET failed_attempts=failed_attempts+1,locked_until=CASE WHEN failed_attempts>=4 THEN ${new Date(Date.now()+300000).toISOString()} ELSE locked_until END WHERE id=${user.id}`);});
      throw new DomainError('LOGIN_FAILED','账号或密码不正确',401);
    }
    const token=randomBytes(32).toString('base64url');
    await repo.scoped(workspace,async tx=>{await tx.execute(sql`UPDATE app_users SET failed_attempts=0,locked_until='' WHERE id=${user.id}`);await tx.execute(sql`INSERT INTO app_sessions(id,workspace_id,user_id,expires_at) VALUES(${digest(token)},${workspace},${user.id},${new Date(Date.now()+8*3600000).toISOString()})`);});
    return {token,user:publicUser(user)};
  }
  async function user(token:string|undefined){if(!token||token.length>200)return null;return repo.scoped(workspace,async tx=>{const row=(await tx.execute(sql`SELECT u.* FROM app_sessions s JOIN app_users u ON u.id=s.user_id AND u.workspace_id=s.workspace_id WHERE s.id=${digest(token)} AND s.expires_at>${new Date().toISOString()} AND u.enabled=true`)).rows[0];return row?publicUser(row):null;});}
  async function require(token:string|undefined,admin=false){const result=await user(token);if(!result)throw new DomainError('AUTH_REQUIRED','请先登录',401);if(admin&&result.role!=='admin')throw new DomainError('FORBIDDEN','此操作仅限管理员',403);return result;}
  async function logout(token:string|undefined){if(token)await repo.scoped(workspace,async tx=>{await tx.execute(sql`DELETE FROM app_sessions WHERE id=${digest(token)}`);});}
  async function users(){return repo.scoped(workspace,async tx=>(await tx.execute(sql`SELECT id,username,role,enabled FROM app_users ORDER BY username`)).rows.map(publicUser));}
  async function disable(id:string,actor:User){if(actor.role!=='admin')throw new DomainError('FORBIDDEN','仅管理员可管理账号',403);if(id===actor.id)throw new DomainError('SELF_DISABLE','不能停用当前账号');await repo.scoped(workspace,async tx=>{await tx.execute(sql`UPDATE app_users SET enabled=false WHERE id=${id}`);await tx.execute(sql`DELETE FROM app_sessions WHERE user_id=${id}`);await tx.execute(sql`UPDATE automation_jobs SET state='paused',document=jsonb_set(jsonb_set(document,'{state}','"paused"'::jsonb),'{error}','"账号已停用，流程已暂停"'::jsonb) WHERE document->>'createdBy'=${id} AND state IN ('queued','running','blocked')`);});}
  return {setupNeeded,create,login,user,require,logout,users,disable};
}
