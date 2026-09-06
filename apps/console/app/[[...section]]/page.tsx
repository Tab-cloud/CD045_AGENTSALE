import {AgentConsole} from '../../components/agent-console';
import {notFound} from 'next/navigation';

export default async function Page({params}:{params:Promise<{section?:string[]}>}){const {section=[]}=await params;if(section[0]==='api')notFound();return <AgentConsole/>;}
