import { Building2, CalendarDays, Users, MessageSquare, History } from 'lucide-react';

const sections = [
  { id: 'listings', label: 'Listings', Icon: Building2 },
  { id: 'reservations', label: 'Reservations', Icon: CalendarDays },
  { id: 'accounts', label: 'Accounts', Icon: Users },
  { id: 'reviews', label: 'Reviews', Icon: MessageSquare },
  { id: 'activity', label: 'Activity log', Icon: History },
] as const;
export type AdminDashboardSection = (typeof sections)[number]['id'];
export default function AdminDashboardTabs({
  value,
  onChange,
}: {
  value: AdminDashboardSection;
  onChange: (section: AdminDashboardSection) => void;
}) {
  return (
    <div className="admin-dashboard-tabs" role="tablist" aria-label="Admin dashboard sections">
      {sections.map(({ id, label, Icon }, index) => (
        <button
          key={id}
          type="button"
          role="tab"
          id={`admin-tab-${id}`}
          aria-controls={`admin-panel-${id}`}
          aria-selected={value === id}
          tabIndex={value === id ? 0 : -1}
          onClick={() => onChange(id)}
          onKeyDown={(event) => {
            const next =
              event.key === 'ArrowRight'
                ? (index + 1) % sections.length
                : event.key === 'ArrowLeft'
                  ? (index + sections.length - 1) % sections.length
                  : event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? sections.length - 1
                      : undefined;
            if (next === undefined) return;
            event.preventDefault();
            onChange(sections[next].id);
            document
              .getElementById(`admin-tab-${sections[next].id}`)
              ?.focus({ preventScroll: true });
          }}
        >
          <Icon size={16} aria-hidden="true" />
          {label}
        </button>
      ))}
    </div>
  );
}
