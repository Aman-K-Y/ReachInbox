import './globals.css';
import type { Metadata } from 'next';
export const metadata: Metadata = { title: 'ReachInbox Email Scheduler', description: 'Schedule, send and search email campaigns.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
