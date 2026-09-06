import {AgentConsole} from '../../components/agent-console';
import {ResearchJob} from '../../components/research-job';
import {notFound} from 'next/navigation';

export default async function Page({params}:{params:Promise<{section?:string[]}>}){const {section=[]}=await params;if(section[0]==='api')notFound();if(section[0]==='automation'&&section[1]==='jobs'&&section[2])return <ResearchJob jobId={section[2]}/>;return <AgentConsole/>;}
