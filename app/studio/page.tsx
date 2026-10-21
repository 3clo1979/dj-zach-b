import {isManager} from '../lib';
import Studio from './studio';
export const dynamic='force-dynamic';
export default async function Page(){
  if(!await isManager())return <main className="studio-login"><div className="section-index">DJ ZACH B / PRIVATE STUDIO</div><h1>Studio access<br/><em>required.</em></h1><p>Open this page through the protected DJ Zach B domain and sign in with your authorized email. The studio stays locked until Cloudflare Access is configured.</p><a href="/">← Back to the website</a></main>;
  return <Studio/>;
}
