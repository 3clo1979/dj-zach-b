import {z} from 'zod';
import { getDb } from '../../../db';
import { inquiries } from '../../../db/schema';
import { referralSources } from '../../booking-finance-contract';
import { FinanceRequestProblem, readManageJson } from '../../booking-finance-server';
import {sameOrigin,validDate,serviceOptions} from '../../lib';
export async function POST(req:Request){
 if(!sameOrigin(req))return Response.json({error:'Request not allowed.'},{status:403});
 if(Number(req.headers.get('content-length')||0)>20000)return Response.json({error:'Message too long.'},{status:413});
 try{const b=z.object({website:z.string().optional(),name:z.string().max(120),email:z.string().email().max(200),phone:z.string().min(1).max(40),date:z.string(),venue:z.string().max(300),eventType:z.enum(['Wedding','Private party','Corporate event','Public appearance','Other celebration']),guests:z.string().max(10),hours:z.string().max(100),message:z.string().max(3000),services:z.array(z.string()).min(1).max(5),consent:z.literal(true),referralSource:z.enum(referralSources).nullable().optional(),referralOther:z.string().max(160).refine(value=>!/[\r\n\0]/.test(value)).transform(value=>value.trim()).nullable().optional()}).refine(value=>!value.referralOther||value.referralSource==='Other').parse(await readManageJson(req,20000));if(b.website)return Response.json({ok:true});
 const fields=['name','email','phone','date','venue','eventType','guests','hours','message'] as const;const d:Record<string,string>={};for(const k of fields)d[k]=String(b[k]||'').trim();
 if(!d.name||!/^\S+@\S+\.\S+$/.test(d.email)||!d.phone||!d.venue||!d.eventType||!validDate(d.date)||d.date<new Date().toISOString().slice(0,10)||Object.values(d).some(v=>v.length>3000)||!b.consent||!Array.isArray(b.services)||!b.services.length||b.services.some((s:string)=>!serviceOptions.includes(s)))return Response.json({error:'Please complete the required details and select at least one service.'},{status:400});
 const id=crypto.randomUUID();await getDb().insert(inquiries).values({id,...d,name:d.name,email:d.email,phone:d.phone,date:d.date,venue:d.venue,eventType:d.eventType,guests:d.guests,hours:d.hours,message:d.message,services:JSON.stringify(b.services),referralSource:b.referralSource??null,referralOther:b.referralSource==='Other'?(b.referralOther||null):null,createdAt:new Date().toISOString()});
 return Response.json({ok:true,reference:id.slice(0,8)});
 }catch(e){if(e instanceof FinanceRequestProblem)return Response.json({error:e.message},{status:e.status});if(e instanceof z.ZodError)return Response.json({error:'Please check your event and contact details.'},{status:400});return Response.json({error:'We could not save your request. Please call or text 440-396-1363.'},{status:500});}
}
