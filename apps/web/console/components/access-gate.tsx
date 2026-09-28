'use client';
import {createContext,useContext,type ReactNode} from 'react';
import type {User} from '@agentsale/automation';
import {PlatformAccount} from './platform-account';
const Session=createContext<User|null>(null);
export const useSession=()=>{const user=useContext(Session);if(!user)throw new Error('请先登录');return user;};
export function AccessGate({children}:{children:ReactNode}){return <PlatformAccount admin>{user=><Session.Provider value={{...user,enabled:true}}>{children}</Session.Provider>}</PlatformAccount>;}
export function Logout(){return null;}
