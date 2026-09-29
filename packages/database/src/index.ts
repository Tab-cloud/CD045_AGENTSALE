import {PGlite} from '@electric-sql/pglite';
import {drizzle} from 'drizzle-orm/pglite';
import {sql} from 'drizzle-orm';
import {migration} from './migration';
import {automationMigration} from './automation-migration';
import {membershipMigration} from './membership-migration';
import {modelMigration} from './model-migration';

export const LOCAL_WORKSPACE='local-rehearsal';
export async function createRepository(dataDir?:string){
  const client=new PGlite(dataDir);
  try{for(const statement of [migration,automationMigration,membershipMigration,modelMigration])await client.exec(statement);}
  catch(error){await client.close().catch(()=>{});throw error;}
  const db=drizzle(client);
  type Tx=Parameters<Parameters<typeof db.transaction>[0]>[0];
  async function scoped<T>(workspace:string,operation:(tx:Tx)=>Promise<T>):Promise<T>{
    return db.transaction(async tx=>{
      await tx.execute(sql.raw('SET LOCAL ROLE agentsale_local'));
      await tx.execute(sql`SELECT set_config('agentsale.workspace',${workspace},true)`);
      return operation(tx);
    });
  }
  return {scoped,db,close:()=>client.close()};
}
export type Repository=Awaited<ReturnType<typeof createRepository>>;
