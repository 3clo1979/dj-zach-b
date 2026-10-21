import { getManagerUser } from './cloudflare-auth';
export async function isManager(){const u=await getManagerUser();return !!u&&['3clo1979@gmail.com','djzachb@yahoo.com'].includes(u.email.toLowerCase());}
export function sameOrigin(req:Request){const o=req.headers.get('origin');return !o||o===new URL(req.url).origin;}
export const statuses=['New','Contacted','Quote sent','Booked','Declined','Canceled'];
export const serviceOptions=['DJ service','Uplighting','Digital photo booth','MC services','Custom playlists'];
export function validDate(s:string){return /^\d{4}-\d{2}-\d{2}$/.test(s)&&!isNaN(Date.parse(s+'T12:00:00Z'))&&new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;}
