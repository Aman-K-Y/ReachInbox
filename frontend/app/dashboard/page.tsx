'use client';

import {
  Bell,
  ChevronDown,
  Clock3,
  Mail,
  MoreHorizontal,
  Search,
  Send,
  Settings,
  Sparkles,
  Upload,
  X
} from 'lucide-react';
import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';

type EmailStatus = 'Scheduled' | 'Sent';

type EmailItem = {
  id: string;
  email: string;
  subject: string;
  time: string;
  scheduledAt: string;
  status: EmailStatus;
  body?: string;
};

const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

function mapEmailJob(job: any): EmailItem {
  const status = job?.status === 'SENT' ? 'Sent' : 'Scheduled';
  const scheduledAt = job?.scheduledAt || new Date().toISOString();
  return {
    id: String(job?.id ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`),
    email: String(job?.to || job?.email || 'unknown@example.com'),
    subject: String(job?.subject || 'Untitled email'),
    time: formatLocalDateTime(new Date(scheduledAt)),
    scheduledAt,
    status,
    body: typeof job?.body === 'string' ? job.body : ''
  };
}

const initialScheduled: EmailItem[] = [
  { id: 's1', email: 'maria@...', subject: 'Welcome to our platform', time: '22 Jan, 2024 10:00 AM', scheduledAt: '2024-01-22T10:00:00.000Z', status: 'Scheduled' },
  { id: 's2', email: 'carlos@...', subject: 'Quarterly update', time: '23 Jan, 2024 02:00 PM', scheduledAt: '2024-01-23T14:00:00.000Z', status: 'Scheduled' }
];

const initialSent: EmailItem[] = [
  { id: 't1', email: 'jada@...', subject: 'Meeting follow-up', time: '20 Jan, 2024 08:30 AM', scheduledAt: '2024-01-20T08:30:00.000Z', status: 'Sent' },
  { id: 't2', email: 'jakob@...', subject: 'Product launch', time: '21 Jan, 2024 09:45 AM', scheduledAt: '2024-01-21T09:45:00.000Z', status: 'Sent' }
];

const notificationList = [
  { title: 'Campaign sent', detail: 'Quarterly update delivered to 90 recipients', time: '2m ago' },
  { title: 'Delivery issue', detail: 'One sender is nearing daily limit', time: '18m ago' },
  { title: 'System check', detail: 'Inbox health looks stable today', time: '1h ago' }
];

const defaultSettings = {
  dailyDigest: true,
  deliveryAlerts: true,
  autoSaveDrafts: false
};

function splitCsvLine(line: string) {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  values.push(current.trim());
  return values;
}

function parseCsvFile(text: string) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (!lines.length) return { rows: [], errors: ['CSV is empty'] };

  const headers = splitCsvLine(lines[0]).map((header) => header.replace(/^\uFEFF/, '').trim().toLowerCase());
  const indexes = {
    to: headers.indexOf('to'),
    subject: headers.indexOf('subject'),
    body: headers.indexOf('body'),
    scheduledAt: headers.indexOf('scheduledat')
  };

  if (Object.values(indexes).some((index) => index < 0)) {
    return { rows: [], errors: ['CSV must include to, subject, body and scheduledAt columns'] };
  }

  const rows: Array<{ to: string; subject: string; body: string; scheduledAt: string }> = [];
  const errors: string[] = [];

  lines.slice(1).forEach((line, rowIndex) => {
    const values = splitCsvLine(line);
    const row = {
      to: values[indexes.to] || '',
      subject: values[indexes.subject] || '',
      body: values[indexes.body] || '',
      scheduledAt: values[indexes.scheduledAt] || ''
    };

    if (!row.to || !row.subject || !row.body || !row.scheduledAt || Number.isNaN(new Date(row.scheduledAt).getTime())) {
      errors.push(`Row ${rowIndex + 2} is invalid or missing data`);
      return;
    }

    rows.push(row);
  });

  return { rows, errors };
}

function formatLocalDateTime(date: Date) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(date);
}

export default function DashboardPage() {
  const [composeOpen, setComposeOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'Scheduled' | 'Sent'>('Scheduled');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState(defaultSettings);
  const [scheduledItems, setScheduledItems] = useState(initialScheduled);
  const [sentItems, setSentItems] = useState(initialSent);
  const [currentUser, setCurrentUser] = useState<{ name?: string; email?: string } | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [rescheduleId, setRescheduleId] = useState<string | null>(null);
  const [rescheduleTime, setRescheduleTime] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [selectedEmail, setSelectedEmail] = useState<EmailItem | null>(null);

  const loadEmails = async () => {
    const token = localStorage.getItem('token');
    if (!token || token === 'guest') return;

    try {
      const response = await fetch(`${apiUrl}/api/emails`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!response.ok) return;

      const rows = await response.json().catch(() => []);
      const mapped = Array.isArray(rows) ? rows.map(mapEmailJob) : [];
      const sentIds = new Set(mapped.filter((item) => item.status === 'Sent').map((item) => item.id));
      const dueNow = mapped.filter((item) => item.status === 'Scheduled' && new Date(item.scheduledAt).getTime() <= Date.now());
      const normalizedScheduled = mapped.filter((item) => item.status === 'Scheduled' && !dueNow.some((due) => due.id === item.id));
      const normalizedSent = [
        ...mapped.filter((item) => item.status === 'Sent'),
        ...dueNow.map((item) => ({ ...item, status: 'Sent' as const, time: formatLocalDateTime(new Date(item.scheduledAt)) }))
      ].filter((item, index, array) => array.findIndex((entry) => entry.id === item.id) === index);

      setScheduledItems(normalizedScheduled.map((item) => ({ ...item, status: 'Scheduled' as const })));
      setSentItems(normalizedSent.map((item) => ({ ...item, status: 'Sent' as const })));
      setMenuOpenId((current) => (current && sentIds.has(current) ? null : current));
    } catch {
      // Keep the local fallback state when the backend is temporarily unreachable.
    }
  };

  useEffect(() => {
    const userFromStorage = localStorage.getItem('user');
    if (userFromStorage) {
      try {
        setCurrentUser(JSON.parse(userFromStorage));
      } catch {
        setCurrentUser(null);
      }
    }
  }, []);

  useEffect(() => {
    void loadEmails();
    const intervalId = window.setInterval(() => {
      void loadEmails();
    }, 3000);

    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const dueItems = scheduledItems.filter((item) => new Date(item.scheduledAt).getTime() <= Date.now());
    if (!dueItems.length) return;

    setScheduledItems((current) => current.filter((item) => !dueItems.some((dueItem) => dueItem.id === item.id)));
    setSentItems((current) => {
      const existingIds = new Set(current.map((item) => item.id));
      const nextSent = dueItems
        .filter((item) => !existingIds.has(item.id))
        .map((item) => ({ ...item, status: 'Sent' as const, time: formatLocalDateTime(new Date(item.scheduledAt)) }));
      return [...nextSent, ...current];
    });
  }, [scheduledItems]);

  const filteredItems = useMemo(() => {
    const items = activeTab === 'Scheduled' ? scheduledItems : sentItems;
    const query = searchQuery.trim().toLowerCase();
    if (!query) return items;
    return items.filter((item) => `${item.subject} ${item.email}`.toLowerCase().includes(query));
  }, [activeTab, searchQuery, scheduledItems, sentItems]);

  const addScheduledItem = (to: string, subject: string, body: string, scheduledAt: string) => {
    const time = formatLocalDateTime(new Date(scheduledAt));
    const nextItem: EmailItem = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      email: to,
      subject,
      time,
      scheduledAt,
      status: 'Scheduled'
    };

    setScheduledItems((current) => [nextItem, ...current]);
    setActiveTab('Scheduled');
  };

  const deleteScheduledItem = async (id: string) => {
    const token = localStorage.getItem('token');
    setMenuOpenId(null);

    try {
      if (token && token !== 'guest') {
        const response = await fetch(`${apiUrl}/api/emails/${id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` }
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload?.error || 'Unable to delete scheduled email');
        }
      }

      setScheduledItems((current) => current.filter((item) => item.id !== id));
      setSelectedEmail((current) => (current && current.id === id ? null : current));
      setActionMessage('Scheduled email deleted.');
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : 'Delete failed');
    }
  };

  const rescheduleScheduledItem = async (id: string) => {
    if (!rescheduleTime) {
      setActionMessage('Please choose a new schedule time.');
      return;
    }

    const token = localStorage.getItem('token');
    const nextDate = new Date(rescheduleTime);
    if (Number.isNaN(nextDate.getTime())) {
      setActionMessage('Please choose a valid reschedule time.');
      return;
    }

    setMenuOpenId(null);
    setRescheduleId(null);

    try {
      if (token && token !== 'guest') {
        const response = await fetch(`${apiUrl}/api/emails/${id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ scheduledAt: nextDate.toISOString() })
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error || 'Unable to reschedule email');
        }
      }

      setScheduledItems((current) => current.map((item) => item.id === id ? { ...item, time: formatLocalDateTime(nextDate), scheduledAt: nextDate.toISOString() } : item));
      setSelectedEmail((current) => current && current.id === id ? { ...current, time: formatLocalDateTime(nextDate), scheduledAt: nextDate.toISOString() } : current);
      setActionMessage('Scheduled email updated.');
      setRescheduleTime('');
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : 'Reschedule failed');
    }
  };

  return (
    <main className="min-h-screen bg-[#121212] p-4 md:p-6">
      <div className="mx-auto flex h-[calc(100vh-2rem)] max-w-[1280px] overflow-hidden rounded-2xl border border-[#2e2e2e] bg-[#f3f3f2] shadow-[0_20px_50px_rgba(0,0,0,0.35)]">
        <aside className="w-[240px] border-r border-[#e3e3e1] bg-[#f7f7f6] p-4">
          <div className="flex items-center justify-between border-b border-[#ebebe8] pb-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#111827] text-xs font-bold text-white">ONB</div>
              <div>
                <p className="text-base font-semibold text-[#111827]">Drivin</p>
              </div>
            </div>
            <button className="text-[#6b7280]" type="button">
              <ChevronDown size={16} />
            </button>
          </div>

          <div className="mt-5 space-y-2">
            {[
              { label: 'Compose', icon: Mail },
              { label: 'Scheduled', icon: Clock3 },
              { label: 'Sent', icon: Send }
            ].map(({ label, icon: Icon }) => {
              const isActive = label === 'Compose' ? composeOpen : activeTab === label;
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => {
                    if (label === 'Compose') {
                      setComposeOpen(true);
                      return;
                    }
                    setActiveTab(label as 'Scheduled' | 'Sent');
                  }}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm font-medium transition ${
                    isActive ? 'bg-[#eaf9f2] text-[#0f172a]' : 'text-[#636c73] hover:bg-[#f0f4f1]'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Icon size={15} />
                    {label}
                  </span>
                  {label === 'Scheduled' ? <span className="rounded-full bg-[#e5e7eb] px-1.5 py-0.5 text-[10px] text-[#4b5563]">{scheduledItems.length}</span> : null}
                </button>
              );
            })}
          </div>

          <div className="mt-6 rounded-xl border border-dashed border-[#dfe8e0] bg-[#f3f7f3] p-3 text-xs text-[#637063]">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-medium text-[#2a2a2a]">Status</span>
              <Sparkles size={14} className="text-[#6aa76c]" />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between"><span>Delivery</span><span className="font-medium text-[#20af69]">Healthy</span></div>
              <div className="flex items-center justify-between"><span>Rate limit</span><span className="font-medium text-[#f59e0b]">Low</span></div>
            </div>
          </div>
        </aside>

        <section className="flex-1 bg-[#f5f5f4] p-4 md:p-6">
          <header className="mb-6 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-[#f7d6a7] to-[#b5d4ff] text-xs font-bold text-[#1f2937]">D</div>
              <div>
                <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[#7a7d7e]">Workspace</p>
                <p className="text-xl font-semibold text-[#111827]">Homepage</p>
              </div>
            </div>

            <div className="relative flex items-center gap-3">
              {searchOpen ? (
                <div className="flex items-center gap-2 rounded-full border border-[#d9dddb] bg-white px-3 py-2 shadow-sm">
                  <Search size={15} className="text-[#4b5563]" />
                  <input
                    aria-label="Search emails"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    className="w-52 bg-transparent text-sm text-[#111827] outline-none placeholder:text-[#7b7f82]"
                    placeholder="Search emails"
                  />
                </div>
              ) : null}

              <div className="flex items-center gap-2 rounded-full border border-[#d9dddb] bg-white px-2 py-1.5 shadow-sm">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#dfeef3] text-xs font-semibold text-[#1f2937]">
                  {(currentUser?.name || currentUser?.email || 'G').charAt(0).toUpperCase()}
                </div>
                <div className="hidden text-left md:block">
                  <p className="text-[10px] uppercase tracking-[0.12em] text-[#7a7d7e]">Signed in</p>
                  <p className="text-xs font-semibold text-[#1f2937]">{currentUser?.email || 'Guest'}</p>
                </div>
              </div>

              <button type="button" className="rounded-full border border-[#d9dddb] bg-white p-2 text-[#4b5563]" onClick={() => setSearchOpen((current) => !current)}>
                <Search size={15} />
              </button>
              <div className="relative">
                <button type="button" className="rounded-full border border-[#d9dddb] bg-white p-2 text-[#4b5563]" onClick={() => setNotificationOpen((current) => !current)}>
                  <Bell size={15} />
                </button>
                {notificationOpen ? (
                  <div className="absolute right-0 top-[calc(100%+12px)] z-20 w-[360px] rounded-2xl border border-[#e7e9e7] bg-white p-4 shadow-[0_18px_40px_rgba(15,23,42,0.12)]">
                    <div className="mb-3 flex items-center justify-between">
                      <p className="text-lg font-semibold text-[#1f2937]">Notifications</p>
                      <button type="button" className="text-sm font-medium text-[#495662]" onClick={() => setNotificationOpen(false)}>Close</button>
                    </div>
                    <div className="space-y-3">
                      {notificationList.map((item) => (
                        <div key={item.title} className="rounded-xl border border-[#f0f1ee] bg-[#fafcfb] p-3">
                          <p className="text-sm font-medium text-[#1f2937]">{item.title}</p>
                          <p className="mt-1 text-sm text-[#64707a]">{item.detail}</p>
                          <p className="mt-2 text-[10px] uppercase tracking-[0.14em] text-[#7a7d7e]">{item.time}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="relative">
                <button type="button" className="rounded-full border border-[#d9dddb] bg-white p-2 text-[#4b5563]" onClick={() => setSettingsOpen((current) => !current)}>
                  <Settings size={15} />
                </button>
                {settingsOpen ? (
                  <div className="absolute right-0 top-[calc(100%+12px)] w-72 rounded-xl border border-[#ebebe8] bg-white p-4 shadow-xl">
                    <div className="mb-3 flex items-center justify-between">
                      <p className="text-sm font-semibold text-[#111827]">Settings</p>
                      <button type="button" className="text-xs text-[#5b6470]" onClick={() => setSettingsOpen(false)}>Close</button>
                    </div>
                    <div className="space-y-3 text-sm text-[#374151]">
                      {Object.entries(settings).map(([key, value]) => (
                        <label key={key} className="flex items-center justify-between gap-3 rounded-lg bg-[#f7f9f8] px-2 py-2">
                          <span className="capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}</span>
                          <input
                            type="checkbox"
                            checked={value}
                            onChange={() => setSettings((current) => ({ ...current, [key]: !current[key as keyof typeof current] }))}
                            className="h-4 w-4 accent-[#4fcf85]"
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </header>

          <div className="rounded-[18px] border border-[#e4e4e3] bg-white p-4 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-3 border-b border-[#f0f0ef] pb-3">
              <div className="flex items-center gap-2 text-sm font-medium text-[#3b3b3b]">
                <span className={`inline-flex rounded-full px-2 py-1 ${activeTab === 'Scheduled' ? 'bg-[#eafaf1] text-[#177a4b]' : 'bg-[#f3f4f6] text-[#475569]'}`}>
                  {activeTab}
                </span>
                <span className="text-[#7b7f82]">{filteredItems.length} items</span>
              </div>

              <button
                type="button"
                onClick={() => setComposeOpen(true)}
                className="rounded-lg bg-[#3b82f6] px-4 py-2 text-sm font-semibold text-white shadow-[0_10px_18px_rgba(59,130,246,0.2)]"
              >
                + Compose
              </button>
            </div>

            <div className="space-y-3">
              {filteredItems.length ? (
                filteredItems.map((item) => (
                  <div key={item.id} className="relative flex w-full items-center justify-between rounded-xl border border-[#edf0ee] bg-[#fafbfa] p-3">
                    <button
                      type="button"
                      onClick={() => setSelectedEmail(item)}
                      className="flex-1 text-left"
                    >
                      <div>
                        <p className="text-base font-semibold text-[#111827]">{item.subject}</p>
                        <p className="mt-1 text-sm text-[#68717a]">{item.email}</p>
                      </div>
                    </button>

                    <div className="flex items-center gap-4 text-sm text-[#5a6068]">
                      <span className={`rounded-full px-2 py-1 font-medium ${item.status === 'Scheduled' ? 'bg-[#edf7f0] text-[#1d9057]' : 'bg-[#edf8ff] text-[#0f6bb6]'}`}>
                        {item.status}
                      </span>
                      <span>{item.time}</span>
                      {item.status === 'Scheduled' ? (
                        <div className="relative">
                          <button
                            type="button"
                            className="rounded-md border border-[#e5e7eb] bg-white p-1.5"
                            onClick={() => setMenuOpenId((current) => current === item.id ? null : item.id)}
                          >
                            <MoreHorizontal size={14} />
                          </button>
                          {menuOpenId === item.id ? (
                            <div className="absolute right-0 top-[calc(100%+8px)] z-10 w-40 rounded-lg border border-[#e8ebea] bg-white p-2 shadow-lg">
                              <button
                                type="button"
                                className="block w-full rounded-md px-2 py-2 text-left text-sm text-[#1f2937] hover:bg-[#f3f7f4]"
                                onClick={() => {
                                  const currentItem = scheduledItems.find((entry) => entry.id === item.id);
                                  if (currentItem) {
                                    const normalized = new Date(currentItem.scheduledAt);
                                    setRescheduleTime(new Date(normalized.getTime() - normalized.getTimezoneOffset() * 60000).toISOString().slice(0, 16));
                                  }
                                  setRescheduleId(item.id);
                                  setMenuOpenId(null);
                                }}
                              >
                                Reschedule
                              </button>
                              <button
                                type="button"
                                className="block w-full rounded-md px-2 py-2 text-left text-sm text-[#b42318] hover:bg-[#fff4f2]"
                                onClick={() => deleteScheduledItem(item.id)}
                              >
                                Delete
                              </button>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-xl border border-dashed border-[#e6e6e4] bg-[#fafaf9] p-6 text-center text-sm text-[#68717a]">
                  No emails match your search.
                </div>
              )}
            </div>
          </div>
        </section>
      </div>

      {composeOpen ? (
        <ComposeModal
          onClose={() => setComposeOpen(false)}
          onSchedule={(to, subject, body, scheduledAt) => {
            addScheduledItem(to, subject, body, scheduledAt);
          }}
        />
      ) : null}

      {rescheduleId ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/20 p-4">
          <div className="w-full max-w-sm rounded-xl border border-[#e8ebea] bg-white p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold text-[#111827]">Reschedule email</p>
              <button type="button" onClick={() => setRescheduleId(null)} className="text-[#5b6470]">
                <X size={16} />
              </button>
            </div>
            <label className="mb-2 block text-xs font-medium uppercase tracking-[0.12em] text-[#697774]">New time</label>
            <input
              type="datetime-local"
              value={rescheduleTime}
              onChange={(event) => setRescheduleTime(event.target.value)}
              className="w-full rounded-md border border-[#e7e9e6] bg-[#fafcfb] px-3 py-2 text-sm outline-none"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setRescheduleId(null)} className="rounded-md border border-[#e5e7eb] bg-white px-3 py-2 text-sm text-[#475569]">
                Cancel
              </button>
              <button type="button" onClick={() => rescheduleScheduledItem(rescheduleId)} className="rounded-md bg-[#2b75ff] px-3 py-2 text-sm font-semibold text-white">
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {selectedEmail ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/25 p-4">
          <div className="w-full max-w-xl rounded-2xl border border-[#e9ecea] bg-white p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-[0.18em] text-[#7a7d7e]">{selectedEmail.status}</p>
                <h3 className="text-xl font-semibold text-[#111827]">{selectedEmail.subject}</h3>
              </div>
              <button type="button" onClick={() => setSelectedEmail(null)} className="rounded-full border border-[#e5e7eb] bg-white p-2 text-[#5b6470]">
                <X size={16} />
              </button>
            </div>

            <div className="space-y-3 text-sm text-[#374151]">
              <div className="flex items-center justify-between rounded-lg bg-[#f8faf9] px-3 py-2">
                <span className="text-[#6b7280]">To</span>
                <span className="font-medium text-[#111827]">{selectedEmail.email}</span>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-[#f8faf9] px-3 py-2">
                <span className="text-[#6b7280]">Scheduled time</span>
                <span className="font-medium text-[#111827]">{selectedEmail.time}</span>
              </div>
              <div className="rounded-lg border border-[#edf0ee] bg-[#fbfcfb] p-3">
                <p className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-[#697774]">Message</p>
                <p className="whitespace-pre-wrap text-sm leading-6 text-[#1f2937]">{selectedEmail.body || 'No content was provided for this email.'}</p>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {actionMessage ? (
        <div className="fixed bottom-5 right-5 z-50 rounded-lg border border-[#dce9dd] bg-[#eefaf3] px-4 py-2 text-sm text-[#1f5d40] shadow-lg">
          {actionMessage}
        </div>
      ) : null}
    </main>
  );
}

type ComposeModalProps = {
  onClose: () => void;
  onSchedule: (to: string, subject: string, body: string, scheduledAt: string) => void;
};

function ComposeModal({ onClose, onSchedule }: ComposeModalProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [to, setTo] = useState('hello@reachinbox.com');
  const [subject, setSubject] = useState('Product launch');
  const [body, setBody] = useState('Hi team,\n\nWe are launching the new campaign this week.');
  const [startTime, setStartTime] = useState(() => {
    const dt = new Date(Date.now() + 30 * 60 * 1000);
    return new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  });
  const [delay, setDelay] = useState('2m');
  const [hourlyLimit, setHourlyLimit] = useState('50');
  const [statusMessage, setStatusMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const handleFileUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = parseCsvFile(text);
      if (parsed.errors.length > 0 && parsed.rows.length === 0) {
        setStatusMessage(parsed.errors[0]);
        return;
      }

      if (parsed.rows.length > 0) {
        const firstRow = parsed.rows[0];
        setTo(firstRow.to);
        setSubject(firstRow.subject);
        setBody(firstRow.body);
        setStartTime(firstRow.scheduledAt);
        setStatusMessage(`Loaded ${parsed.rows.length} recipients from ${file.name}.`);
      }
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Unable to read the file');
    } finally {
      event.target.value = '';
    }
  };

  const handleSubmit = async () => {
    if (!to.trim() || !subject.trim() || !body.trim()) {
      setStatusMessage('To, subject and body are required.');
      return;
    }

    setLoading(true);
    setStatusMessage('');

    const scheduledUtc = new Date(startTime);
    if (Number.isNaN(scheduledUtc.getTime())) {
      setStatusMessage('Please choose a valid start time.');
      setLoading(false);
      return;
    }

    const token = localStorage.getItem('token');

    try {
      const payload = {
        to,
        subject,
        body,
        scheduledAt: scheduledUtc.toISOString(),
        delayBetweenEmails: delay,
        hourlyLimit: Number(hourlyLimit) || 50
      };

      if (token) {
        const response = await fetch(`${apiUrl}/api/emails/schedule`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify(payload)
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data?.error || 'Unable to schedule email');
        }
      }

      onSchedule(to, subject, body, scheduledUtc.toISOString());
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Schedule failed';
      setStatusMessage(message);
      onSchedule(to, subject, body, scheduledUtc.toISOString());
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/25 p-4">
      <div className="w-full max-w-[720px] rounded-[18px] border border-[#eceae6] bg-[#f7f7f6] p-5 shadow-[0_25px_80px_rgba(0,0,0,0.25)]">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-[#7d8885]">Compose</p>
            <h2 className="mt-1 text-2xl font-semibold text-[#151515]">New Email</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-full border border-[#e3e6e3] bg-white p-2 text-[#5b6470]">
            <X size={16} />
          </button>
        </div>

        <div className="grid gap-4 md:grid-cols-[1.4fr_0.6fr]">
          <div className="space-y-4">
            <div className="rounded-xl border border-[#e7e8e5] bg-white p-3">
              <label className="mb-2 block text-xs font-medium uppercase tracking-[0.12em] text-[#697774]">From</label>
              <div className="flex items-center justify-between gap-3 rounded-md border border-[#e9ecea] bg-[#f7faf7] px-3 py-2">
                <span className="text-sm text-[#37534a]">driver@reachinbox.com</span>
                <button type="button" className="text-xs font-medium text-[#1f2937]">Edit</button>
              </div>
            </div>

            <div className="rounded-xl border border-[#e7e8e5] bg-white p-3">
              <label className="mb-2 block text-xs font-medium uppercase tracking-[0.12em] text-[#697774]">To</label>
              <input
                value={to}
                onChange={(event) => setTo(event.target.value)}
                className="w-full rounded-md border border-[#e7e9e6] bg-[#fafcfb] px-3 py-2.5 text-sm text-[#2b2f31] outline-none"
              />
            </div>

            <div className="rounded-xl border border-[#e7e8e5] bg-white p-3">
              <label className="mb-2 block text-xs font-medium uppercase tracking-[0.12em] text-[#697774]">Subject</label>
              <input
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                className="w-full rounded-md border border-[#e7e9e6] bg-[#fafcfb] px-3 py-2.5 text-sm text-[#2b2f31] outline-none"
              />
            </div>

            <div className="rounded-xl border border-[#e7e8e5] bg-white p-3">
              <div className="mb-2 flex items-center justify-between">
                <label className="text-xs font-medium uppercase tracking-[0.12em] text-[#697774]">Body</label>
                <div className="flex items-center gap-2 text-[#4b5563]">
                  <button type="button" className="rounded border border-[#e5e7eb] bg-white px-2 py-1 text-xs">B</button>
                  <button type="button" className="rounded border border-[#e5e7eb] bg-white px-2 py-1 text-xs italic">I</button>
                  <button type="button" className="rounded border border-[#e5e7eb] bg-white px-2 py-1 text-xs underline">U</button>
                </div>
              </div>
              <textarea
                rows={7}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                className="w-full resize-none rounded-md border border-[#e7e9e6] bg-[#fafcfb] px-3 py-2.5 text-sm text-[#2b2f31] outline-none"
              />
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div className="rounded-xl border border-[#e7e8e5] bg-white p-3">
              <label className="mb-2 block text-xs font-medium uppercase tracking-[0.12em] text-[#697774]">Upload List</label>
              <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFileUpload} />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-[#cfe2d5] bg-[#f3faf5] px-3 py-3 text-sm font-medium text-[#1d6d4b]"
              >
                <Upload size={16} />
                Upload CSV
              </button>
            </div>

            <div className="rounded-xl border border-[#e7e8e5] bg-white p-3">
              <label className="mb-2 block text-xs font-medium uppercase tracking-[0.12em] text-[#697774]">Schedule</label>
              <div className="space-y-3">
                <div>
                  <span className="mb-1 block text-xs text-[#627168]">Start time</span>
                  <input
                    type="datetime-local"
                    value={startTime}
                    onChange={(event) => setStartTime(event.target.value)}
                    className="w-full rounded-md border border-[#e7e9e6] bg-[#fafcfb] px-3 py-2 text-sm outline-none"
                  />
                </div>
                <div>
                  <span className="mb-1 block text-xs text-[#627168]">Delay between emails</span>
                  <input
                    value={delay}
                    onChange={(event) => setDelay(event.target.value)}
                    className="w-full rounded-md border border-[#e7e9e6] bg-[#fafcfb] px-3 py-2 text-sm outline-none"
                  />
                </div>
                <div>
                  <span className="mb-1 block text-xs text-[#627168]">Hourly limit</span>
                  <input
                    value={hourlyLimit}
                    onChange={(event) => setHourlyLimit(event.target.value)}
                    className="w-full rounded-md border border-[#e7e9e6] bg-[#fafcfb] px-3 py-2 text-sm outline-none"
                  />
                </div>
              </div>
            </div>

            <button
              type="button"
              disabled={loading}
              onClick={handleSubmit}
              className="mt-auto rounded-xl bg-[#2b75ff] px-4 py-3 text-sm font-semibold text-white shadow-[0_12px_24px_rgba(43,117,255,0.25)] hover:bg-[#1f68eb] disabled:cursor-not-allowed disabled:opacity-70"
            >
              {loading ? 'Scheduling...' : 'Schedule Email'}
            </button>

            {statusMessage ? <p className="text-xs text-[#475569]">{statusMessage}</p> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
