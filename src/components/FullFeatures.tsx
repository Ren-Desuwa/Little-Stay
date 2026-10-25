import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Bell, Check, Download, MessageCircle, Send, Star } from 'lucide-react';
import Modal from './Modal';
import { change, getState, request } from '../lib/api';
import {
  addDays,
  money,
  today,
  type Data,
  type Property,
  type Reservation,
  type User,
} from '../lib/model';

type Props = {
  data: Data;
  user: User;
  onData: (data: Data) => void;
  onNotice: (text: string) => void;
};
function useAction(props: Props) {
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function run(path: string, body?: unknown, method = 'POST', message = 'Saved.') {
    if (busy) return false;
    setError('');
    setBusy(true);
    try {
      props.onData(await change(path, body, method));
      props.onNotice(message);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { run, error, busy };
}
function ErrorText({ text }: { text: string }) {
  return text ? (
    <p className="field-error" role="alert">
      {text}
    </p>
  ) : null;
}
export function AuthModal({
  onClose,
  onData,
}: {
  onClose: () => void;
  onData: (data: Data) => void;
}) {
  const [register, setRegister] = useState(false),
    [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [name, setName] = useState(''),
    [role, setRole] = useState('guest'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      onData(
        await change(
          register ? '/auth/register' : '/auth/login',
          register ? { name, email, password, role } : { email, password },
        ),
      );
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={register ? 'Make room for a little more.' : 'Welcome back.'} onClose={onClose}>
      <p className="auth-intro">
        {register
          ? 'Create your local account. Host applications are reviewed by an administrator.'
          : 'Sign in to book, host, and manage your stays.'}
      </p>
      <form className="stack-form" onSubmit={submit}>
        {register && (
          <label>
            Full name
            <input required value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          </label>
        )}
        <label>
          Email
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            required
            minLength={register ? 8 : 1}
            maxLength={128}
            autoComplete={register ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {register && (
          <label>
            Account type
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="guest">Guest · find and book stays</option>
              <option value="host">Host · apply to list properties</option>
            </select>
          </label>
        )}
        <ErrorText text={error} />
        <button className="primary" disabled={busy}>
          {busy ? 'Please wait…' : register ? 'Create account' : 'Sign in'} <Check size={16} />
        </button>
      </form>
      <button
        className="text-button"
        onClick={() => {
          setRegister(!register);
          setError('');
        }}
      >
        {register ? 'Already have an account? Sign in' : 'New here? Create an account'}
      </button>
      {!register && (
        <details className="sample-accounts">
          <summary>Seeded accounts for local testing</summary>
          <p>
            All seeded accounts use <code>LittleStay123!</code>. Select one to fill the form, then
            sign in.
          </p>
          <div>
            {[
              ['alex', 'Alex · guest'],
              ['jamie', 'Jamie · guest'],
              ['isabel', 'Isabel · host'],
              ['marco', 'Marco · host'],
              ['admin', 'Sam · admin'],
            ].map(([id, label]) => (
              <button
                key={id}
                className="outline small"
                onClick={() => {
                  setEmail(id + '@littlestay.local');
                  setPassword('LittleStay123!');
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </details>
      )}
    </Modal>
  );
}
export function AccountPage(props: Props) {
  const { user } = props,
    { run, error, busy } = useAction(props);
  const [name, setName] = useState(user.name),
    [bio, setBio] = useState(user.bio ?? ''),
    [old, setOld] = useState(''),
    [password, setPassword] = useState('');
  return (
    <section className="page-section">
      <div className="eyebrow">YOUR ACCOUNT</div>
      <h1>A little about you.</h1>
      <div className="full-columns">
        <form
          className="lab-panel stack-form"
          onSubmit={(e) => {
            e.preventDefault();
            void run('/profile', { name, bio }, 'PATCH', 'Profile saved.');
          }}
        >
          <h2>Profile</h2>
          <label>
            Name
            <input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Email
            <input value={user.email ?? ''} disabled />
          </label>
          <label>
            About you
            <textarea
              maxLength={500}
              rows={4}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
            />
          </label>
          <p>
            Role: {user.role}
            {user.role === 'host' && ` · Host status: ${user.hostStatus}`}
          </p>
          <button className="primary" disabled={busy}>
            Save profile
          </button>
        </form>
        <form
          className="lab-panel stack-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await run(
                '/profile/password',
                { currentPassword: old, newPassword: password },
                'POST',
                'Password changed. Other sessions were signed out.',
              )
            ) {
              setOld('');
              setPassword('');
            }
          }}
        >
          <h2>Change password</h2>
          <label>
            Current password
            <input
              type="password"
              required
              autoComplete="current-password"
              value={old}
              onChange={(e) => setOld(e.target.value)}
            />
          </label>
          <label>
            New password
            <input
              type="password"
              required
              minLength={8}
              maxLength={128}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button className="primary" disabled={busy}>
            Change password
          </button>
        </form>
      </div>
      <ErrorText text={error} />
    </section>
  );
}
export function MessagesPage(props: Props) {
  const { data, user } = props,
    { run, error, busy } = useAction(props),
    [selected, setSelected] = useState(''),
    [drafts, setDrafts] = useState<Record<string, string>>({});
  const threads = data.threads ?? [],
    thread = threads.find((t) => t.id === selected) ?? threads[0];
  const messages = (data.messages ?? []).filter((m) => m.threadId === thread?.id);
  const body = thread ? (drafts[thread.id] ?? '') : '';
  useEffect(() => {
    if (!threads.some((t) => t.id === selected)) setSelected(threads[0]?.id ?? '');
  }, [threads, selected]);
  return (
    <section className="page-section">
      <div className="eyebrow">A LITTLE CONVERSATION</div>
      <h1>Your messages.</h1>
      <p className="page-intro">
        Private conversations between each guest and their host. Updates refresh automatically.
      </p>
      <div className="message-layout">
        <aside className="thread-list">
          {!threads.length && <p>No conversations yet. Open a property and choose Message host.</p>}
          {threads.map((t) => (
            <button
              key={t.id}
              className={t.id === thread?.id ? 'selected' : ''}
              onClick={() => setSelected(t.id)}
            >
              <strong>
                {data.properties.find((p) => p.id === t.propertyId)?.title ??
                  'Property conversation'}
              </strong>
              <small>
                {data.users.find((u) => u.id === (user.id === t.guestId ? t.hostId : t.guestId))
                  ?.name ?? 'Your host'}
              </small>
            </button>
          ))}
        </aside>
        <div className="message-pane">
          {thread ? (
            <>
              <h3>
                {data.properties.find((p) => p.id === thread.propertyId)?.title ?? 'Conversation'}
              </h3>
              <div className="message-history" aria-live="polite">
                {!messages.length && <p>Say hello and ask about the stay.</p>}
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={`message-bubble ${m.senderId === user.id ? 'mine' : ''}`}
                  >
                    <strong>
                      {m.senderId === user.id
                        ? 'You'
                        : (data.users.find((u) => u.id === m.senderId)?.name ?? 'Host')}
                    </strong>
                    <p>{m.body}</p>
                    <small>
                      {new Date(m.createdAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}
                    </small>
                  </div>
                ))}
              </div>
              <form
                className="message-compose"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (
                    await run(`/threads/${thread.id}/messages`, { body }, 'POST', 'Message sent.')
                  )
                    setDrafts((current) =>
                      current[thread.id] === body ? { ...current, [thread.id]: '' } : current,
                    );
                }}
              >
                <label className="sr-only" htmlFor="message-body">
                  Message
                </label>
                <textarea
                  id="message-body"
                  required
                  maxLength={2000}
                  rows={2}
                  placeholder="Write a message…"
                  value={body}
                  onChange={(e) =>
                    setDrafts((current) => ({ ...current, [thread.id]: e.target.value }))
                  }
                />
                <button className="primary" disabled={busy || !body.trim()}>
                  <Send size={17} /> Send
                </button>
              </form>
            </>
          ) : (
            <div className="empty-state">
              <MessageCircle size={32} />
              <h3>A conversation starts with hello.</h3>
            </div>
          )}
          <ErrorText text={error} />
        </div>
      </div>
    </section>
  );
}
export function NotificationsPage(props: Props) {
  const { run, error, busy } = useAction(props);
  return (
    <section className="page-section">
      <div className="eyebrow">IN THE LOOP</div>
      <div className="section-heading">
        <h1>Your notifications.</h1>
        <button
          className="outline"
          disabled={busy}
          onClick={() =>
            void run('/notifications/read', {}, 'POST', 'Notifications marked as read.')
          }
        >
          Mark all read
        </button>
      </div>
      <div className="notification-list">
        {!(props.data.notifications ?? []).length && (
          <div className="empty-state">
            <Bell size={30} />
            <h3>You’re all caught up.</h3>
          </div>
        )}
        {props.data.notifications?.map((n) => (
          <article className={n.read ? '' : 'unread'} key={n.id}>
            <Bell size={18} />
            <div>
              <p>{n.body}</p>
              <small>
                {new Date(n.createdAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}
              </small>
            </div>
            {!n.read && <span className="badge">NEW</span>}
          </article>
        ))}
      </div>
      <ErrorText text={error} />
    </section>
  );
}
export function HostTools(props: Props) {
  const { data, user } = props,
    { run, error, busy } = useAction(props);
  const properties = data.properties.filter((p) => p.hostId === user.id),
    [pid, setPid] = useState(properties[0]?.id ?? ''),
    [start, setStart] = useState(''),
    [end, setEnd] = useState(''),
    [reason, setReason] = useState('Maintenance');
  const selected = properties.find((p) => p.id === pid) ?? properties[0];
  if (user.role !== 'host') return null;
  return (
    <section className="dashboard-tools">
      <h2>Availability blocks</h2>
      <p>Block nights for maintenance or personal use. Existing reservations cannot be blocked.</p>
      {user.hostStatus !== 'approved' ? (
        <p className="field-error">
          Your host application is {user.hostStatus}. An administrator must approve it before you
          can manage listings.
        </p>
      ) : (
        <>
          <form
            className="host-block-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (selected)
                void run(
                  `/properties/${selected.id}/block`,
                  { start, end, reason },
                  'POST',
                  'Dates blocked.',
                );
            }}
          >
            <label>
              Property
              <select value={selected?.id ?? ''} onChange={(e) => setPid(e.target.value)}>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              From
              <input
                type="date"
                min={today()}
                required
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </label>
            <label>
              Until (exclusive)
              <input
                type="date"
                min={start || today()}
                required
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </label>
            <label>
              Reason
              <input
                required
                maxLength={200}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <button className="primary" disabled={busy || !selected}>
              Block dates
            </button>
          </form>
          <div className="block-list">
            {(data.calendar ?? [])
              .filter((c) => c.kind === 'blocked' && properties.some((p) => p.id === c.propertyId))
              .map((c) => (
                <div key={c.id}>
                  <span>
                    <strong>{properties.find((p) => p.id === c.propertyId)?.title}</strong> ·{' '}
                    {c.start} → {c.end} · {c.reason}
                  </span>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() =>
                      void run(`/blocks/${c.id}`, undefined, 'DELETE', 'Date block removed.')
                    }
                  >
                    Remove block
                  </button>
                </div>
              ))}
          </div>
        </>
      )}
      <ErrorText text={error} />
    </section>
  );
}
export function AdminTools(props: Props & { section: 'accounts' | 'reviews' | 'activity' }) {
  const { data } = props,
    { run, error, busy } = useAction(props);
  return (
    <section className="dashboard-tools">
      {props.section === 'accounts' && (
        <>
          <h2>Account management</h2>
          <p>
            Approve host applications and suspend or restore accounts. Administrator accounts are
            protected.
          </p>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Role / status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.users.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <strong>{u.name}</strong>
                      <small className="block-small">{u.email}</small>
                    </td>
                    <td>
                      {u.role} ·{' '}
                      {u.suspended ? 'suspended' : u.role === 'host' ? u.hostStatus : 'active'}
                    </td>
                    <td>
                      {u.role !== 'admin' && (
                        <div className="table-actions">
                          {u.role === 'host' && u.hostStatus !== 'approved' && (
                            <button
                              className="outline small"
                              disabled={busy}
                              onClick={() =>
                                void run(
                                  `/admin/users/${u.id}`,
                                  { action: 'approve' },
                                  'POST',
                                  'Host approved.',
                                )
                              }
                            >
                              Approve host
                            </button>
                          )}
                          {u.role === 'host' && u.hostStatus === 'pending' && (
                            <button
                              className="text-button"
                              disabled={busy}
                              onClick={() =>
                                void run(
                                  `/admin/users/${u.id}`,
                                  { action: 'reject' },
                                  'POST',
                                  'Host application rejected.',
                                )
                              }
                            >
                              Reject
                            </button>
                          )}
                          <button
                            className="outline small"
                            disabled={busy}
                            onClick={() =>
                              void run(
                                `/admin/users/${u.id}`,
                                { action: u.suspended ? 'restore' : 'suspend' },
                                'POST',
                                'Account updated.',
                              )
                            }
                          >
                            {u.suspended ? 'Restore' : 'Suspend'}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {props.section === 'reviews' && (
        <>
          <h2>Review moderation</h2>
          <div className="block-list">
            {data.reviews?.map((r) => (
              <div key={r.id}>
                <span>
                  <strong>{r.rating}/5</strong> · {r.body}
                </span>
                <button
                  className="outline small"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      `/admin/reviews/${r.id}`,
                      { hidden: !r.hidden },
                      'POST',
                      'Review visibility updated.',
                    )
                  }
                >
                  {r.hidden ? 'Restore review' : 'Hide review'}
                </button>
              </div>
            ))}
          </div>
          {!data.reviews?.length && <p>No reviews to moderate yet.</p>}
        </>
      )}
      {props.section === 'activity' && (
        <>
          <h2>Activity log</h2>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Actor</th>
                  <th>Action</th>
                  <th>Record</th>
                </tr>
              </thead>
              <tbody>
                {data.audit?.map((a) => (
                  <tr key={a.id}>
                    <td>
                      {new Date(a.createdAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}
                    </td>
                    <td>{data.users.find((u) => u.id === a.actorId)?.name ?? a.actorId}</td>
                    <td>{a.action}</td>
                    <td>
                      <code>{a.targetId}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!data.audit?.length && <p>No activity recorded yet.</p>}
        </>
      )}
      <ErrorText text={error} />
    </section>
  );
}
export function GuestReviews(props: Props) {
  const { run, error, busy } = useAction(props);
  const eligible = props.data.reservations.filter(
    (r) =>
      r.guestId === props.user.id &&
      r.status === 'completed' &&
      !props.data.reviews?.some((v) => v.bookingId === r.id),
  );
  const [bookingId, setBooking] = useState(''),
    [rating, setRating] = useState(5),
    [body, setBody] = useState('');
  const selectedBooking = eligible.find((r) => r.id === bookingId) ?? eligible[0];
  return (
    <section className="dashboard-tools">
      <h2>Your reviews</h2>
      {eligible.length > 0 ? (
        <form
          className="review-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await run(
                '/reviews',
                { bookingId: selectedBooking?.id, rating, body },
                'POST',
                'Thank you. Your review has been published.',
              )
            ) {
              setBody('');
              setBooking('');
            }
          }}
        >
          <label>
            Completed stay
            <select value={selectedBooking?.id ?? ''} onChange={(e) => setBooking(e.target.value)}>
              {eligible.map((r) => (
                <option key={r.id} value={r.id}>
                  {props.data.properties.find((p) => p.id === r.propertyId)?.title} · {r.reference}
                </option>
              ))}
            </select>
          </label>
          <label>
            Rating
            <select value={rating} onChange={(e) => setRating(Number(e.target.value))}>
              {[5, 4, 3, 2, 1].map((n) => (
                <option key={n} value={n}>
                  {n} / 5
                </option>
              ))}
            </select>
          </label>
          <label>
            Your experience
            <textarea
              required
              minLength={10}
              maxLength={1000}
              rows={3}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </label>
          <button className="primary" disabled={busy}>
            Publish review <Star size={15} />
          </button>
        </form>
      ) : (
        <p>Reviews become available after your host records checkout.</p>
      )}
      <div className="review-list">
        {props.data.reviews
          ?.filter((r) => r.guestId === props.user.id)
          .map((r) => (
            <article key={r.id}>
              <strong>
                {r.rating}/5 · {props.data.properties.find((p) => p.id === r.propertyId)?.title}
              </strong>
              <p>{r.body}</p>
              {r.hidden && <small>Hidden by an administrator</small>}
            </article>
          ))}
      </div>
      <ErrorText text={error} />
    </section>
  );
}
type Report = {
  start: string;
  end: string;
  totalBookings: number;
  occupancy: number;
  bookedValue: number;
  rows: {
    propertyId: string;
    property: string;
    bookings: number;
    occupiedNights: number;
    occupancy: number;
    bookedValue: number;
  }[];
};

export function ReportsPage(props: Props) {
  const [start, setStart] = useState(today().slice(0, 7) + '-01'),
    [end, setEnd] = useState(addDays(today(), 30)),
    [report, setReport] = useState<Report | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function load() {
    if (busy) return;
    setBusy(true);
    setError('');
    setReport(null);
    try {
      setReport(await request<Report>(`/reports?start=${start}&end=${end}`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  return (
    <section className="page-section">
      <div className="eyebrow">A CLEARER PICTURE</div>
      <h1>Your hosting, in numbers.</h1>
      <p className="page-intro">
        Occupancy and booked accommodation value. These are booking records, not payment or revenue
        records.
      </p>
      <form
        className="report-filters"
        onSubmit={(e) => {
          e.preventDefault();
          void load();
        }}
      >
        <label>
          From
          <input type="date" required value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label>
          Until (exclusive)
          <input type="date" required value={end} onChange={(e) => setEnd(e.target.value)} />
        </label>
        <button className="primary" disabled={busy}>
          {busy ? 'Loading…' : 'Update report'}
        </button>
        {report && (
          <a
            href={`/api/reports?start=${report.start}&end=${report.end}&format=csv`}
            className="outline"
            download
          >
            <Download size={16} /> Export CSV
          </a>
        )}
      </form>
      <ErrorText text={error} />
      {report && (
        <>
          <p role="status">
            Report period: {report.start} → {report.end} (exclusive)
          </p>
          <div className="stats-grid">
            <div>
              <strong>{report.totalBookings}</strong>
              <span>bookings overlapping the period</span>
            </div>
            <div>
              <strong>{report.occupancy}%</strong>
              <span>calendar occupancy</span>
            </div>
            <div>
              <strong>{money(report.bookedValue)}</strong>
              <span>booked value within the period</span>
            </div>
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Property</th>
                  <th>Bookings</th>
                  <th>Occupied nights</th>
                  <th>Occupancy</th>
                  <th>Booked value</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((r) => (
                  <tr key={r.propertyId}>
                    <td>{r.property}</td>
                    <td>{r.bookings}</td>
                    <td>{r.occupiedNights}</td>
                    <td>{r.occupancy}%</td>
                    <td>{money(r.bookedValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
export function AvailabilityCalendar({ data, property }: { data: Data; property: Property }) {
  const [month, setMonth] = useState(today().slice(0, 7));
  const days = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate(),
    offset = new Date(month + '-01T12:00:00').getDay();
  const entries = (data.calendar ?? []).filter((c) => c.propertyId === property.id);
  return (
    <div className="availability-calendar">
      <label>
        Availability calendar
        <input
          type="month"
          value={month}
          onChange={(e) => {
            if (e.target.value) setMonth(e.target.value);
          }}
        />
      </label>
      <div className="calendar-grid">
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => (
          <strong key={d}>{d}</strong>
        ))}
        {Array.from({ length: offset }, (_, i) => (
          <span key={'blank' + i} />
        ))}
        {Array.from({ length: days }, (_, i) => {
          const date = `${month}-${String(i + 1).padStart(2, '0')}`,
            entry = entries.find((c) => date >= c.start && date < c.end);
          return (
            <span
              key={date}
              title={`${date}: ${entry ? 'unavailable' : 'available'}`}
              className={entry ? 'unavailable' : date < today() ? 'past' : ''}
            >
              {i + 1}
            </span>
          );
        })}
      </div>
      <small>Shaded dates are reserved or blocked. Checkout dates can be booked.</small>
    </div>
  );
}
export function BookingSummary({
  reservation: r,
  property,
  user,
}: {
  reservation: Reservation;
  property?: Property;
  user?: User;
}) {
  return (
    <>
      <div className="printable-booking">
        <h1>Little Stay · Booking summary</h1>
        <p>North Caloocan accommodation reservation</p>
        <h2>{property?.title}</h2>
        <p>{property?.address ?? property?.neighborhood}</p>
        <dl>
          <dt>Reference</dt>
          <dd>{r.reference}</dd>
          <dt>Guest</dt>
          <dd>{user?.name ?? 'Guest'}</dd>
          <dt>Check-in</dt>
          <dd>{r.checkIn}</dd>
          <dt>Checkout</dt>
          <dd>{r.checkOut}</dd>
          <dt>Guests</dt>
          <dd>{r.guests}</dd>
          <dt>Status</dt>
          <dd>{r.status}</dd>
          <dt>Nightly rate</dt>
          <dd>{money(r.nightlyRate)}</dd>
          <dt>Total accommodation value</dt>
          <dd>{money(r.total)}</dd>
        </dl>
        <p>
          This summary records a reservation. No payment is collected or recorded by this
          application.
        </p>
      </div>
      <button className="primary" onClick={() => window.print()}>
        Print summary
      </button>
    </>
  );
}
