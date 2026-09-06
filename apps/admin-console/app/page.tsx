import {redirect} from 'next/navigation';
import {AdminApp} from '../components/admin-app';

export default async function Page({searchParams}:{searchParams:Promise<{advanced?:string|string[]}>}){const {advanced}=await searchParams;if(advanced!=='1')redirect('http://127.0.0.1:3045/');return <AdminApp/>;}
