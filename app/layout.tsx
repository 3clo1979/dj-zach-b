import type {Metadata} from 'next';import './globals.css';
export const metadata:Metadata={title:'DJ Zach B | Your Day. Your Soundtrack.',description:'Wedding DJ services, uplighting, and digital photo booth. Plan your celebration with DJ Zach B. Request your date.',icons:{icon:'/images/dj-zach-b-logo.png'}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
