'use client';
import {createContext,useContext,type ReactNode} from 'react';
import type {User} from '@agentsale/automation';

const localUser:User={id:'00000000-0000-4000-8000-000000000045',username:'本机用户',role:'operator',enabled:true};
const Session=createContext<User>(localUser);
export const useSession=()=>useContext(Session);
export function AccessGate({children}:{children:ReactNode}){return <Session.Provider value={localUser}>{children}</Session.Provider>;}
export function Logout(){return null;}
