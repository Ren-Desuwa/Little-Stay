import { region } from './lib/region';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import {
  ArrowDownUp,
  ArrowUp,
  ArrowRight,
  Bath,
  BedDouble,
  Check,
  ChevronDown,
  Coffee,
  Heart,
  House,
  Leaf,
  MapPin,
  Map as MapIcon,
  Search,
  SlidersHorizontal,
  Sparkles,
  Users,
  Wifi,
  X,
  Plus,
  LayoutGrid,
  CalendarDays,
  Building2,
  FlaskConical,
  Bell,
  MessageCircle,
  UserCircle,
  LogOut,
  BarChart3,
  CheckCircle2,
} from 'lucide-react';
import StayMap from './components/StayMap';
import Modal from './components/Modal';
import AdminDashboardTabs, { type AdminDashboardSection } from './components/AdminDashboardTabs';
import { locateCell, project, voronoi } from './lib/algorithms';
import {
  amenities,
  addDays,
  available,
  buildIndexes,
  findProperties,
  money,
  nights,
  today,
  validateDates,
  validateBookingDates,
  type Data,
  type Filters,
  type Property,
  type User,
} from './lib/model';
import { photos } from './lib/seed';
import { googleErrors } from './components/GoogleSignIn';
import { emptyData, getState, getStateOrder, change, request, uploadPhotos } from './lib/api';
import {
  AuthModal,
  AccountPage,
  MessagesPage,
  NotificationsPage,
  HostTools,
  AdminTools,
  GuestReviews,
  ReportsPage,
  AvailabilityCalendar,
  BookingSummary,
} from './components/FullFeatures';

const AlgorithmLab = lazy(() => import('./components/AlgorithmLab'));

const defaultFilters: Filters = {
  query: '',
  maxPrice: 10000,
  guests: 1,
  amenities: [],
  checkIn: '',
  checkOut: '',
  sort: 'recommended',
};
const formatDate = (value: string) =>
  new Date(value + 'T12:00:00').toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
function App() {
  const [data, updateData] = useState<Data>(emptyData);
  const appliedStateOrder = useRef(0);
  const setData = useCallback((next: Data) => {
    const order = getStateOrder(next);
    // A delayed poll must not restore data from an earlier account or overwrite a newer mutation.
    if (order < appliedStateOrder.current) return;
    appliedStateOrder.current = order;
    updateData((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
  }, []);
  const [authOpen, setAuthOpen] = useState(false),
    [loading, setLoading] = useState(true),
    [connectionError, setConnectionError] = useState('');
  const [authError, setAuthError] = useState('');
  useEffect(() => {
    const url = new URL(window.location.href);
    const reason = url.searchParams.get('auth_error');
    if (reason) {
      setAuthError(googleErrors[reason] ?? googleErrors.failed);
      setAuthOpen(true);
      url.searchParams.delete('auth_error');
      window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    }
  }, []);
  const [page, setPage] = useState(() => window.location.hash.slice(1) || 'explore');
  const [adminTab, setAdminTab] = useState<AdminDashboardSection>('listings');
  const [navHidden, setNavHidden] = useState(false);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const measure = () =>
      document.documentElement.style.setProperty(
        '--site-header-height',
        `${header.offsetHeight}px`,
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty('--site-header-height');
    };
  }, []);
  useEffect(() => {
    let lastPosition = window.scrollY;
    let directionAnchor = lastPosition;
    let direction = 0;
    const onScroll = () => {
      const position = Math.max(0, window.scrollY);
      setShowBackToTop(position > 400);
      const nextDirection = Math.sign(position - lastPosition);
      if (nextDirection && nextDirection !== direction) {
        direction = nextDirection;
        directionAnchor = lastPosition;
      }
      if (position < (headerRef.current?.offsetHeight ?? 100)) setNavHidden(false);
      else if (Math.abs(position - directionAnchor) > 12) setNavHidden(direction > 0);
      lastPosition = position;
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const [filters, setFilters] = useState<Filters>(defaultFilters),
    [filtersOpen, setFiltersOpen] = useState(false),
    [mapOpen, setMapOpen] = useState(false),
    [overlay, setOverlay] = useState(false);
  const [activeId, setActiveId] = useState<string>(),
    [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [detail, setDetail] = useState<string | null>(null),
    [editing, setEditing] = useState<Property | null>(null),
    [notice, setNotice] = useState('');
  const [confirmation, setConfirmation] = useState<{
    title: string;
    body: string;
    action: () => void | Promise<unknown>;
  } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const favorites = data.favorites ?? [];
  const [category, setCategory] = useState('All stays');
  const indexes = useMemo(() => buildIndexes(data), [data]);
  const user: User = data.currentUser ?? { id: 'visitor', name: 'Visitor', role: 'guest' };
  const loggedIn = !!data.currentUser;
  useEffect(() => {
    setAdminTab('listings');
    setDetail(null);
    setEditing(null);
    setConfirmation(null);
  }, [user.id]);
  const fullProps = { data, user, onData: setData, onNotice: setNotice };
  async function refresh() {
    try {
      setData(await getState());
      setConnectionError('');
    } catch (e) {
      setConnectionError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  useEffect(() => {
    let active = true;
    let polling = false;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && !polling) {
        polling = true;
        getState()
          .then((next) => {
            if (active) {
              setData(next);
              setConnectionError('');
              setLoading(false);
            }
          })
          .catch((e: Error) => {
            if (active) setConnectionError(e.message);
          })
          .finally(() => {
            polling = false;
          });
      }
    }, 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [user.id]);
  useEffect(() => {
    if (loading) return;
    if (
      (page === 'lab' && user.role !== 'admin') ||
      (page === 'reports' && loggedIn && user.role === 'guest') ||
      (page === 'explore' && user.role === 'host')
    ) {
      navigate(loggedIn ? 'dashboard' : 'explore');
    }
  }, [loading, page, user.role, loggedIn]);
  const results = useMemo(() => findProperties(data, filters), [data, filters]);
  const properties = useMemo(() => results.map((r) => r.property), [results]);
  const [visibleCount, setVisibleCount] = useState(24);
  useEffect(() => setVisibleCount(24), [filters]);
  const cells = useMemo(() => voronoi(properties), [properties]);
  const nearestId = pin ? locateCell(project(pin.lat, pin.lng), cells) : undefined;
  const nearest = nearestId ? indexes.properties.get(nearestId) : undefined;
  useEffect(() => {
    const onHash = () => setPage(window.location.hash.slice(1) || 'explore');
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(''), 7000);
    return () => window.clearTimeout(id);
  }, [notice]);
  function navigate(next: string) {
    window.location.hash = next;
    setPage(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  async function perform(action: () => Promise<Data>, message: string) {
    try {
      const next = await action();
      setData(next);
      setNotice(message);
      return true;
    } catch (e) {
      setNotice((e as Error).message);
      return false;
    }
  }
  function toggleFavorite(id: string) {
    if (!loggedIn) {
      setAuthOpen(true);
      return;
    }
    void perform(
      () => change(`/favorites/${id}`),
      favorites.includes(id) ? 'Stay removed from favorites.' : 'Stay saved.',
    );
  }
  function updateFilters(patch: Partial<Filters>) {
    setFilters((f) => ({ ...f, ...patch }));
  }
  function chooseCategory(value: string) {
    setCategory(value);
    const map: Record<string, string> = {
      'Work-friendly': 'Workspace',
      'Pool days': 'Pool',
      'With a balcony': 'Balcony',
      'Easy parking': 'Parking',
    };
    updateFilters({ amenities: map[value] ? [map[value]] : [] });
  }
  const scopedReservations = data.reservations.filter(
    (r) =>
      user.role === 'admin' ||
      (user.role === 'guest'
        ? r.guestId === user.id
        : indexes.properties.get(r.propertyId)?.hostId === user.id),
  );
  const labData = { ...data, reservations: scopedReservations };
  const detailProperty = detail ? indexes.properties.get(detail) : undefined;
  const dashboard =
    user.role === 'guest'
      ? 'My bookings'
      : user.role === 'host'
        ? 'Host dashboard'
        : 'Admin dashboard';
  function newProperty() {
    setEditing({
      id: `stay-${crypto.randomUUID()}`,
      hostId: user.id,
      title: '',
      neighborhood: region.defaultNeighborhood,
      description: '',
      price: 2500,
      capacity: 2,
      bedrooms: 1,
      amenities: ['WiFi', 'Air conditioning'],
      lat: region.defaultPropertyLocation.lat,
      lng: region.defaultPropertyLocation.lng,
      image: photos[0],
      published: false,
      suspended: false,
      images: [photos[0]],
      address: '',
      propertyType: 'Apartment',
      houseRules: 'No smoking indoors. Quiet hours: 10 PM–7 AM.',
      checkInInstructions: 'Check in from 2 PM. Checkout by 11 AM.',
      approval: 'pending',
    });
  }
  return (
    <>
      <header ref={headerRef} className={`site-header ${navHidden ? 'nav-hidden' : ''}`}>
        <a
          className="brand"
          href="#explore"
          onClick={() => navigate('explore')}
          aria-label="Little Stay home"
        >
          <span className="brand-symbol">
            <House size={23} strokeWidth={1.7} />
            <span />
          </span>
          little stay<span className="brand-dot">.</span>
        </a>
        <nav aria-label="Main navigation">
          {user.role !== 'host' && (
            <button
              className={page === 'explore' ? 'active' : ''}
              onClick={() => navigate('explore')}
            >
              Find a stay
            </button>
          )}
          <button
            className={page === 'dashboard' ? 'active' : ''}
            onClick={() => (loggedIn ? navigate('dashboard') : setAuthOpen(true))}
          >
            {dashboard}
          </button>
          {loggedIn && user.role === 'admin' && (
            <button className={page === 'lab' ? 'active' : ''} onClick={() => navigate('lab')}>
              <FlaskConical size={15} /> Algorithm lab
            </button>
          )}
          {loggedIn && user.role === 'guest' && (
            <button
              className={filters.savedOnly ? 'active' : ''}
              onClick={() => {
                updateFilters({ savedOnly: !filters.savedOnly });
                navigate('explore');
              }}
            >
              Saved stays
            </button>
          )}
          {loggedIn && user.role !== 'guest' && (
            <button
              className={page === 'reports' ? 'active' : ''}
              onClick={() => navigate('reports')}
            >
              <BarChart3 size={15} /> Reports
            </button>
          )}
        </nav>
        <div className="account full-account">
          {(import.meta.env.DEV || data.demo) && (
            <span className="demo-pill">
              {data.demo ? 'DEMO · FICTIONAL STAYS' : 'LOCAL · SQL'}
            </span>
          )}
          {loggedIn ? (
            <>
              <button
                className="icon-button"
                aria-label="Messages"
                onClick={() => navigate('messages')}
              >
                <MessageCircle size={18} />
              </button>
              <button
                className="icon-button notification-button"
                aria-label="Notifications"
                onClick={() => navigate('notifications')}
              >
                <Bell size={18} />
                {data.notifications?.some((n) => !n.read) && <i />}
              </button>
              <button className="account-name" onClick={() => navigate('profile')}>
                <span className="avatar">
                  {user.name
                    .split(' ')
                    .map((n) => n[0])
                    .join('')}
                </span>
                <span>
                  {user.name}
                  <small>
                    {user.role}
                    {user.role === 'host' && user.hostStatus !== 'approved'
                      ? ' · ' + user.hostStatus
                      : ''}
                  </small>
                </span>
              </button>
              <button
                className="icon-button"
                aria-label="Sign out"
                onClick={async () => {
                  if (await perform(() => change('/auth/logout'), 'Signed out.')) {
                    setDetail(null);
                    setEditing(null);
                    navigate('explore');
                  }
                }}
              >
                <LogOut size={16} />
              </button>
            </>
          ) : (
            <button className="primary" onClick={() => setAuthOpen(true)}>
              <UserCircle size={16} /> Sign in
            </button>
          )}
        </div>
      </header>
      <main>
        {loading && (
          <p className="connection-notice" role="status">
            Loading listings…
          </p>
        )}
        {connectionError && (
          <div className="connection-notice" role="alert">
            Local API connection failed: {connectionError} Run npm run dev to start both services.{' '}
            <button className="text-button" onClick={() => void refresh()}>
              Retry connection
            </button>
          </div>
        )}

        {page === 'explore' && user.role !== 'host' && (
          <>
            <section className="hero">
              <div className="hero-copy">
                <div className="eyebrow">
                  <span className="tiny-line" /> A LITTLE SPACE. A BETTER STAY.
                </div>
                <h1>
                  Make yourself
                  <br /> at <span>home.</span>
                  <Leaf className="hero-leaf" size={43} strokeWidth={1.2} />
                </h1>
                <p>
                  Thoughtfully chosen spaces for your next city chapter.
                  <br className="desktop-break" /> Find your kind of stay, right here in North
                  Caloocan.
                </p>
                <div className="hero-note">
                  <span className="mini-avatars">
                    <img src={photos[1]} alt="" />
                    <img src={photos[2]} alt="" />
                    <span>
                      <House size={14} />
                    </span>
                  </span>
                  <span>
                    Small escapes. <strong>Lovely possibilities.</strong>
                  </span>
                </div>
              </div>
              <div className="hero-photo">
                <img
                  src={photos[0]}
                  alt="Sunlit living room with neutral furnishings and a comfortable sofa"
                />
                <div className="photo-shade" />
                <div className="hero-photo-caption">
                  <span>
                    <MapPin size={14} /> CAMARIN, NORTH CALOOCAN
                  </span>
                  <strong>Your slow morning starts here.</strong>
                </div>
                <div className="photo-stamp">
                  <Sparkles size={17} />
                  <span>
                    STAY A LITTLE.
                    <br />
                    FEEL AT HOME.
                  </span>
                </div>
              </div>
            </section>
            <form
              className="search-bar"
              onSubmit={(e) => {
                e.preventDefault();
                try {
                  if (filters.checkIn || filters.checkOut)
                    validateDates(filters.checkIn, filters.checkOut);
                  document.getElementById('stays')?.scrollIntoView({ behavior: 'smooth' });
                } catch (e) {
                  setNotice((e as Error).message);
                }
              }}
            >
              <label className="search-location">
                <MapPin size={19} />
                <span>
                  <b>Where to?</b>
                  <input
                    aria-label="Search properties and amenities"
                    placeholder=" North Caloocan, a neighborhood, or an amenity"
                    value={filters.query}
                    onChange={(e) => updateFilters({ query: e.target.value })}
                  />
                </span>
              </label>
              <label>
                <CalendarDays size={18} />
                <span>
                  <b>Check-in</b>
                  <input
                    aria-label="Search check-in"
                    type="date"
                    min={today()}
                    value={filters.checkIn}
                    onChange={(e) => updateFilters({ checkIn: e.target.value })}
                  />
                </span>
              </label>
              <label>
                <CalendarDays size={18} />
                <span>
                  <b>Checkout</b>
                  <input
                    aria-label="Search checkout"
                    type="date"
                    min={filters.checkIn || today()}
                    value={filters.checkOut}
                    onChange={(e) => updateFilters({ checkOut: e.target.value })}
                  />
                </span>
              </label>
              <label className="search-guests">
                <Users size={18} />
                <span>
                  <b>Guests</b>
                  <select
                    aria-label="Search guests"
                    value={filters.guests}
                    onChange={(e) => updateFilters({ guests: Number(e.target.value) })}
                  >
                    {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>
                        {n} guest{n > 1 ? 's' : ''}
                      </option>
                    ))}
                  </select>
                </span>
              </label>
              <button className="primary search-button">
                <Search size={18} /> Find a stay
              </button>
            </form>
            {(filters.checkIn || filters.checkOut) &&
              (!filters.checkIn ||
                !filters.checkOut ||
                filters.checkOut <= filters.checkIn ||
                filters.checkIn < today()) && (
                <p className="date-warning" role="status">
                  Choose both dates, with a future checkout after check-in, to search availability.
                </p>
              )}
            <section className="explore-section" id="stays">
              <div className="category-row">
                <div className="categories">
                  {[
                    ['All stays', House],
                    ['Work-friendly', Wifi],
                    ['Pool days', Bath],
                    ['With a balcony', Leaf],
                    ['Easy parking', Building2],
                  ].map(([label, Icon]) => {
                    const C = Icon as typeof House;
                    return (
                      <button
                        key={label as string}
                        className={category === label ? 'active' : ''}
                        onClick={() => chooseCategory(label as string)}
                      >
                        <C size={17} strokeWidth={1.6} />
                        {label as string}
                      </button>
                    );
                  })}
                </div>
                <button
                  className={`outline filters-button ${filtersOpen ? 'active' : ''}`}
                  onClick={() => setFiltersOpen(!filtersOpen)}
                >
                  <SlidersHorizontal size={16} /> Filters
                  {filters.amenities.length > 0 && (
                    <span className="filter-count">{filters.amenities.length}</span>
                  )}
                </button>
              </div>
              {filtersOpen && (
                <div className="filter-panel">
                  <label>
                    Maximum nightly price:{' '}
                    {filters.maxPrice === 10000 ? 'No limit' : money(filters.maxPrice)}
                    <input
                      aria-label="Maximum nightly price"
                      type="range"
                      min="1000"
                      max="10000"
                      step="100"
                      value={filters.maxPrice}
                      onChange={(e) => updateFilters({ maxPrice: Number(e.target.value) })}
                    />
                  </label>
                  <div className="extra-filters">
                    <label>
                      Neighborhood
                      <select
                        value={filters.neighborhood ?? ''}
                        onChange={(e) => updateFilters({ neighborhood: e.target.value })}
                      >
                        <option value="">All neighborhoods</option>
                        {['Camarin', 'Deparo', 'Bagumbong', 'Tala', 'Bagong Silang'].map((n) => (
                          <option key={n}>{n}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Property type
                      <select
                        value={filters.propertyType ?? ''}
                        onChange={(e) => updateFilters({ propertyType: e.target.value })}
                      >
                        <option value="">All types</option>
                        {['Studio', 'Apartment', 'House', 'Private room'].map((n) => (
                          <option key={n}>{n}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Minimum bedrooms
                      <input
                        type="number"
                        min="0"
                        max="10"
                        value={filters.minBedrooms ?? 0}
                        onChange={(e) => updateFilters({ minBedrooms: Number(e.target.value) })}
                      />
                    </label>
                    {loggedIn && user.role === 'guest' && (
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={!!filters.savedOnly}
                          onChange={(e) => updateFilters({ savedOnly: e.target.checked })}
                        />{' '}
                        Saved stays only
                      </label>
                    )}
                  </div>
                  <fieldset>
                    <legend>Amenities</legend>
                    <div className="amenity-options">
                      {amenities.map((a) => (
                        <label key={a}>
                          <input
                            type="checkbox"
                            checked={filters.amenities.includes(a)}
                            onChange={() => {
                              setCategory('All stays');
                              updateFilters({
                                amenities: filters.amenities.includes(a)
                                  ? filters.amenities.filter((v) => v !== a)
                                  : [...filters.amenities, a],
                              });
                            }}
                          />
                          {a}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <button
                    className="text-button"
                    onClick={() => {
                      setFilters(defaultFilters);
                      setCategory('All stays');
                      setPin(null);
                    }}
                  >
                    Reset filters
                  </button>
                </div>
              )}
              <div className="results-heading">
                <div>
                  <div className="eyebrow muted">FIND YOUR LITTLE CORNER</div>
                  <h2>
                    Good places. Great stays<span className="green-dot">.</span>
                  </h2>
                  <p>
                    {properties.length} thoughtfully chosen stays in North Caloocan
                    {filters.query && ` matching “${filters.query}”`}
                  </p>
                </div>
                <div className="result-controls">
                  <label className="sort-select">
                    <ArrowDownUp size={14} />
                    <select
                      aria-label="Sort properties"
                      value={filters.sort}
                      onChange={(e) => updateFilters({ sort: e.target.value })}
                    >
                      <option value="recommended">Recommended</option>
                      <option value="price-low">Price: low to high</option>
                      <option value="price-high">Price: high to low</option>
                    </select>
                  </label>
                  <button
                    className={`outline ${mapOpen ? 'active' : ''}`}
                    onClick={() => setMapOpen(!mapOpen)}
                  >
                    {mapOpen ? <LayoutGrid size={16} /> : <MapIcon size={16} />}{' '}
                    {mapOpen ? 'Grid view' : 'Map view'}
                  </button>
                </div>
              </div>
              {filters.query && results.some((r) => r.score > 0) && (
                <div className="fuzzy-note">
                  <Sparkles size={15} /> A little typo is okay. Results include similar words.
                  {results
                    .find((r) => r.score > 0)
                    ?.matches.filter((m) => m.distance > 0)
                    .map((m) => (
                      <span key={m.token}>
                        <b>{m.token}</b> → {m.word}
                      </span>
                    ))}
                </div>
              )}
              {mapOpen ? (
                <div className="map-explore">
                  <div className="map-toolbar">
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={overlay}
                        onChange={(e) => setOverlay(e.target.checked)}
                      />{' '}
                      Show Voronoi regions
                    </label>
                    <span>Approximate straight-line proximity</span>
                    {pin && (
                      <button className="text-button" onClick={() => setPin(null)}>
                        Clear pin
                      </button>
                    )}
                  </div>
                  <div className="map-layout">
                    <StayMap
                      properties={properties}
                      activeId={activeId}
                      onSelect={(id) => {
                        setPin(null);
                        setActiveId(id);
                      }}
                      overlay={overlay}
                      pin={pin}
                      onPin={(p) => {
                        setPin(p);
                        setActiveId(undefined);
                      }}
                    />
                    <aside className="map-sidebar">
                      <span className="eyebrow">
                        {nearest ? 'CLOSEST TO YOUR PIN' : 'EXPLORE THE NEIGHBORHOOD'}
                      </span>
                      {nearest ? (
                        <>
                          <PropertyCard
                            property={nearest}
                            onOpen={() => setDetail(nearest.id)}
                            favorite={favorites.includes(nearest.id)}
                            onFavorite={() => toggleFavorite(nearest.id)}
                          />
                          <p className="technical-note">
                            {Math.hypot(
                              project(nearest.lat, nearest.lng).x - project(pin!.lat, pin!.lng).x,
                              project(nearest.lat, nearest.lng).y - project(pin!.lat, pin!.lng).y,
                            ).toFixed(2)}{' '}
                            km from your pin, approximately.
                          </p>
                        </>
                      ) : activeId &&
                        properties.some((p) => p.id === activeId) &&
                        indexes.properties.get(activeId) ? (
                        <PropertyCard
                          property={indexes.properties.get(activeId)!}
                          onOpen={() => setDetail(activeId)}
                          favorite={favorites.includes(activeId)}
                          onFavorite={() => toggleFavorite(activeId)}
                        />
                      ) : (
                        <>
                          <MapPin size={32} />
                          <h3>Your next stay is a pin away.</h3>
                          <p>
                            Choose a property marker for details, or click inside the map area to
                            find your nearest matching stay.
                          </p>
                        </>
                      )}
                      {!properties.length && <p>No properties match your filters.</p>}
                    </aside>
                  </div>
                </div>
              ) : (
                <div className="property-grid">
                  {properties.slice(0, visibleCount).map((p, i) => (
                    <PropertyCard
                      key={p.id}
                      property={p}
                      onOpen={() => setDetail(p.id)}
                      favorite={favorites.includes(p.id)}
                      onFavorite={() => toggleFavorite(p.id)}
                      featured={i === 0 && !filters.query}
                    />
                  ))}
                </div>
              )}
              {!mapOpen && properties.length > 0 && (
                <div className="load-more">
                  <span>
                    Showing {Math.min(visibleCount, properties.length)} of {properties.length} stays
                  </span>
                  {visibleCount < properties.length && (
                    <button className="outline" onClick={() => setVisibleCount((n) => n + 24)}>
                      Show more stays
                    </button>
                  )}
                </div>
              )}
              {!properties.length && !mapOpen && (
                <div className="empty-state">
                  <Search size={32} />
                  <h3>No stays found just yet.</h3>
                  <p>Try another keyword, fewer amenities, or different dates.</p>
                  <button
                    className="outline"
                    onClick={() => {
                      setFilters(defaultFilters);
                      setCategory('All stays');
                    }}
                  >
                    Clear all filters
                  </button>
                </div>
              )}
              <div className="local-banner">
                <div className="banner-icon">
                  <Coffee size={25} strokeWidth={1.4} />
                </div>
                <div>
                  <h3>A new neighborhood. A familiar feeling.</h3>
                  <p>
                    From a quick city escape to a longer change of scenery, find a space that feels
                    like you.
                  </p>
                </div>
                <span>
                  MAKE ROOM FOR A LITTLE MORE <ArrowRight size={16} />
                </span>
              </div>
            </section>
          </>
        )}
        {page === 'dashboard' && loggedIn && (
          <section className="page-section dashboard">
            <div className="eyebrow">YOUR LITTLE STAY</div>
            <div className="section-heading">
              <div>
                <h1>
                  {user.role === 'guest'
                    ? 'Your next chapter.'
                    : user.role === 'host'
                      ? 'A home for your hosting.'
                      : 'Keep every stay in good hands.'}
                </h1>
                <p className="page-intro">
                  {user.role === 'guest'
                    ? 'Your reservations, all in one little place.'
                    : user.role === 'host'
                      ? 'Manage your spaces and see who’s checking in.'
                      : 'Oversee accounts, listings, and reservations.'}
                </p>
              </div>
              {user.role === 'host' && (
                <button
                  className="primary"
                  onClick={newProperty}
                  disabled={user.hostStatus !== 'approved'}
                >
                  <Plus size={17} /> Add a listing
                </button>
              )}
            </div>
            <div className="stats-grid">
              <div>
                <strong>{scopedReservations.filter((r) => r.status === 'confirmed').length}</strong>
                <span>confirmed reservations</span>
              </div>
              <div>
                <strong>
                  {money(
                    scopedReservations
                      .filter((r) => r.status === 'confirmed')
                      .reduce((s, r) => s + r.total, 0),
                  )}
                </strong>
                <span>
                  {user.role === 'guest' ? 'reserved stays' : 'booked value · no payments'}
                </span>
              </div>
              {user.role !== 'guest' && (
                <div>
                  <strong>
                    {
                      data.properties.filter((p) => user.role === 'admin' || p.hostId === user.id)
                        .length
                    }
                  </strong>
                  <span>properties</span>
                </div>
              )}
            </div>
            {user.role === 'admin' && (
              <>
                <div id="admin-dashboard-start" />
                <AdminDashboardTabs
                  value={adminTab}
                  onChange={(next) => {
                    setAdminTab(next);
                    setNavHidden(false);
                    requestAnimationFrame(() =>
                      document
                        .getElementById('admin-dashboard-start')
                        ?.scrollIntoView({ block: 'start', behavior: 'instant' }),
                    );
                  }}
                />
              </>
            )}
            <div
              className={user.role === 'admin' ? 'admin-dashboard-panel' : undefined}
              id={user.role === 'admin' ? `admin-panel-${adminTab}` : undefined}
              role={user.role === 'admin' ? 'tabpanel' : undefined}
              aria-labelledby={user.role === 'admin' ? `admin-tab-${adminTab}` : undefined}
              tabIndex={user.role === 'admin' ? 0 : undefined}
            >
              {user.role !== 'guest' && (user.role !== 'admin' || adminTab === 'listings') && (
                <>
                  <h2 className="dashboard-heading">
                    {user.role === 'host' ? 'Your listings' : 'All listings'}
                  </h2>
                  <div className="table-scroll">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Property</th>
                          <th>Nightly price</th>
                          <th>Status</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.properties
                          .filter((p) => user.role === 'admin' || p.hostId === user.id)
                          .map((p) => (
                            <tr key={p.id}>
                              <td>
                                <div className="table-property">
                                  <img src={p.image} alt="" />
                                  <span>
                                    <strong>{p.title}</strong>
                                    <small>{p.neighborhood}</small>
                                  </span>
                                </div>
                              </td>
                              <td>{money(p.price)}</td>
                              <td>
                                <span
                                  className={`status ${p.suspended ? 'cancelled' : p.approval !== 'approved' ? 'draft' : p.published ? 'confirmed' : 'draft'}`}
                                >
                                  {p.suspended
                                    ? 'Suspended'
                                    : p.approval !== 'approved'
                                      ? p.approval
                                      : p.published
                                        ? 'Published'
                                        : 'Draft'}
                                </span>
                              </td>
                              <td>
                                <div className="table-actions">
                                  {user.role === 'host' ? (
                                    <>
                                      <button
                                        className="outline small"
                                        onClick={() => setEditing({ ...p })}
                                      >
                                        Edit listing
                                      </button>
                                      <button
                                        className="text-button"
                                        onClick={() =>
                                          perform(
                                            () =>
                                              change(`/properties/${p.id}/publish`, {
                                                published: !p.published,
                                              }),
                                            p.published
                                              ? 'Listing unpublished.'
                                              : 'Listing published.',
                                          )
                                        }
                                      >
                                        {p.published ? 'Unpublish' : 'Publish'}
                                      </button>
                                    </>
                                  ) : (
                                    <>
                                      {p.approval !== 'approved' && (
                                        <>
                                          <button
                                            className="outline small"
                                            onClick={() =>
                                              void perform(
                                                () =>
                                                  change(`/admin/properties/${p.id}`, {
                                                    action: 'approve',
                                                  }),
                                                'Listing approved.',
                                              )
                                            }
                                          >
                                            Approve
                                          </button>
                                          <button
                                            className="text-button"
                                            onClick={() =>
                                              void perform(
                                                () =>
                                                  change(`/admin/properties/${p.id}`, {
                                                    action: 'reject',
                                                  }),
                                                'Listing rejected.',
                                              )
                                            }
                                          >
                                            Reject
                                          </button>
                                        </>
                                      )}
                                      <button
                                        className={`outline small ${p.suspended ? '' : 'danger-text'}`}
                                        onClick={() =>
                                          perform(
                                            () =>
                                              change(`/admin/properties/${p.id}`, {
                                                action: p.suspended ? 'restore' : 'suspend',
                                              }),
                                            p.suspended
                                              ? 'Listing restored.'
                                              : 'Listing suspended. Existing bookings are preserved.',
                                          )
                                        }
                                      >
                                        {p.suspended ? 'Restore' : 'Suspend'}
                                      </button>
                                    </>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
              {(user.role !== 'admin' || adminTab === 'reservations') && (
                <ReservationList
                  key={`reservations-${user.id}`}
                  data={data}
                  user={user}
                  onRefresh={setData}
                  onNotice={setNotice}
                  onCancel={(id) =>
                    setConfirmation({
                      title: 'Cancel this reservation?',
                      body: 'These dates will become available again. The reservation will be cancelled and its dates released.',
                      action: () =>
                        perform(
                          () => change(`/bookings/${id}/cancel`),
                          'Reservation cancelled. The dates are available again.',
                        ),
                    })
                  }
                />
              )}
              {user.role === 'guest' && <GuestReviews key={`reviews-${user.id}`} {...fullProps} />}
              {user.role === 'host' && <HostTools key={`host-tools-${user.id}`} {...fullProps} />}
              {user.role === 'admin' && adminTab !== 'listings' && adminTab !== 'reservations' && (
                <AdminTools
                  key={`admin-tools-${user.id}-${adminTab}`}
                  section={adminTab}
                  {...fullProps}
                />
              )}
            </div>
          </section>
        )}
        {loggedIn && user.role === 'admin' && page === 'lab' && (
          <Suspense fallback={<p role="status">Loading algorithm lab…</p>}>
            <AlgorithmLab key={`algorithm-lab-${user.id}`} data={labData} properties={properties} />
          </Suspense>
        )}
        {loggedIn && page === 'profile' && (
          <AccountPage key={`profile-${user.id}`} {...fullProps} />
        )}
        {loggedIn && page === 'messages' && (
          <MessagesPage key={`messages-${user.id}`} {...fullProps} />
        )}
        {loggedIn && page === 'notifications' && (
          <NotificationsPage key={`notifications-${user.id}`} {...fullProps} />
        )}
        {loggedIn && user.role !== 'guest' && page === 'reports' && (
          <ReportsPage key={`reports-${user.id}`} {...fullProps} />
        )}
        {page === 'privacy' && (
          <section className="page-section">
            <div className="eyebrow">PRIVACY &amp; TERMS</div>
            <h1>Your account and your stays.</h1>
            <div className="lab-panel stack-form">
              <h2>What we store</h2>
              <p>
                Little Stay stores your name, email, password hash, profile, bookings, saved stays,
                messages, reviews, notifications, and account activity. Hosts provide listing
                details, photos, and private check-in instructions. Session cookies keep you signed
                in for up to eight hours.
              </p>
              <h2>Who can see it</h2>
              <p>
                Listing information and published reviews are public. Booking details are available
                to the guest, responsible host, and administrators. Messages are shared with the
                participants. Hosts and guests receive check-in instructions when authorized.
                Uploaded photos are publicly accessible; avoid including private information.
              </p>
              <h2>Maps and service providers</h2>
              <p>
                Map tiles come from the configured map provider, which receives your IP address and
                tile requests. Hosting providers process requests and maintain service logs. Little
                Stay does not process payments.
              </p>
              <h2>Access and deletion requests</h2>
              <p>
                Sign in and use the button below to request account deletion from the
                administrators. You can update your profile in Account. For other access or
                correction requests, use the contact details supplied with your booking or
                invitation. The operator must verify account ownership and explain any booking
                records that need to be retained. Deleted information may remain in backups until
                those backups expire.
              </p>
              {loggedIn ? (
                <button
                  className="outline"
                  onClick={() =>
                    perform(
                      () => change('/profile/deletion-request'),
                      'Deletion request sent to the administrators.',
                    )
                  }
                >
                  Request account deletion
                </button>
              ) : (
                <button className="outline" onClick={() => setAuthOpen(true)}>
                  Sign in to request deletion
                </button>
              )}
              <h2>Using Little Stay</h2>
              <p>
                Keep account information accurate, protect your password, and share only photos and
                content you have permission to use. Confirm listing details, house rules,
                availability, and cancellation arrangements with the host before travel. A booking
                confirmation does not collect payment. Listings marked as demo are fictional and are
                not rental offers.
              </p>
            </div>
          </section>
        )}
        {!loggedIn &&
          ['dashboard', 'profile', 'messages', 'notifications', 'reports'].includes(page) && (
            <div className="empty-state">
              <h2>Sign in to continue.</h2>
              <button className="primary" onClick={() => setAuthOpen(true)}>
                Sign in
              </button>
            </div>
          )}
        {![
          'explore',
          'dashboard',
          'lab',
          'profile',
          'messages',
          'notifications',
          'reports',
          'privacy',
        ].includes(page) && (
          <div className="empty-state">
            <h1>That page wandered off.</h1>
            <button className="primary" onClick={() => navigate('explore')}>
              Find a stay
            </button>
          </div>
        )}
      </main>
      <footer>
        <a className="brand footer-brand" href="#explore">
          <House size={22} /> little stay.
        </a>
        <span>Made for little escapes. Built with a little algorithm magic.</span>
        <div>
          {(import.meta.env.DEV || data.demo) && (
            <span className="footer-demo">
              <span /> Fictional seed listings · Local database
            </span>
          )}
          <a href="#privacy">Privacy &amp; terms</a>
        </div>
      </footer>
      {detailProperty && (
        <BookingModal
          key={detailProperty.id}
          property={detailProperty}
          data={data}
          user={user}
          filters={filters}
          onClose={() => setDetail(null)}
          onSignIn={() => {
            setDetail(null);
            setAuthOpen(true);
          }}
          onMessage={async () => {
            if (!loggedIn) {
              setDetail(null);
              setAuthOpen(true);
              return;
            }
            try {
              await request('/threads', 'POST', { propertyId: detailProperty.id });
              setData(await getState());
              setDetail(null);
              navigate('messages');
            } catch (e) {
              setNotice((e as Error).message);
            }
          }}
          onBook={async (input) => {
            const next = await change('/bookings', input);
            setData(next);
            setNotice('Your reservation is confirmed.');
            setDetail(null);
            navigate('dashboard');
            return true;
          }}
        />
      )}
      {editing && (
        <PropertyEditor
          property={editing}
          data={data}
          user={user}
          onClose={() => setEditing(null)}
          onSave={async (property) => {
            const exists = data.properties.some((p) => p.id === property.id);
            const next = await change(
              exists ? `/properties/${property.id}` : '/properties',
              property,
              exists ? 'PATCH' : 'POST',
            );
            setData(next);
            setNotice('Listing saved and submitted for admin review.');
            setEditing(null);
          }}
        />
      )}
      {confirmation && (
        <Modal title={confirmation.title} onClose={() => setConfirmation(null)}>
          <p>{confirmation.body}</p>
          <div className="modal-actions">
            <button className="outline" disabled={confirming} onClick={() => setConfirmation(null)}>
              Keep it as is
            </button>
            <button
              className="primary"
              disabled={confirming}
              onClick={async () => {
                if (confirming) return;
                setConfirming(true);
                try {
                  await confirmation.action();
                  setConfirmation(null);
                } finally {
                  setConfirming(false);
                }
              }}
            >
              Confirm
            </button>
          </div>
        </Modal>
      )}
      {authOpen && (
        <AuthModal
          initialError={authError}
          onClose={() => {
            setAuthOpen(false);
            setAuthError('');
          }}
          onData={(next) => {
            setData(next);
            setNotice(`Signed in as ${next.currentUser?.name}.`);
          }}
        />
      )}
      {showBackToTop && (
        <button
          className="back-to-top"
          type="button"
          aria-label="Back to top"
          title="Back to top"
          onClick={() => {
            setNavHidden(false);
            window.scrollTo({
              top: 0,
              behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
                ? 'instant'
                : 'smooth',
            });
          }}
        >
          <ArrowUp size={21} aria-hidden="true" />
        </button>
      )}
      {notice && (
        <div className="toast" role="status">
          <span>{notice}</span>
          <button aria-label="Dismiss notification" onClick={() => setNotice('')}>
            <X size={18} />
          </button>
        </div>
      )}
    </>
  );
}

function PropertyCard({
  property: p,
  onOpen,
  favorite,
  onFavorite,
  featured,
}: {
  property: Property;
  onOpen: () => void;
  favorite: boolean;
  onFavorite: () => void;
  featured?: boolean;
}) {
  const images = [...new Set([p.image, ...(p.images ?? [])])];
  const galleryKey = JSON.stringify(images);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [manualSelection, setManualSelection] = useState(0);
  const firstDelay = useRef(1000);
  const activePhoto = photoIndex % images.length;
  useEffect(() => setPhotoIndex(0), [galleryKey]);
  useEffect(() => {
    if (!hovered || images.length < 2) return;
    let timer: ReturnType<typeof setTimeout>;
    const advance = () => {
      setPhotoIndex((index) => (index + 1) % images.length);
      timer = setTimeout(advance, 5000);
    };
    const schedule = (delay: number) => {
      clearTimeout(timer);
      if (document.visibilityState === 'visible') timer = setTimeout(advance, delay);
    };
    const onVisibilityChange = () => schedule(5000);
    schedule(firstDelay.current);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [hovered, galleryKey, manualSelection]);
  function selectPhoto(index: number) {
    setPhotoIndex(index);
    firstDelay.current = 5000;
    setManualSelection((value) => value + 1);
  }
  return (
    <article
      className="property-card"
      onMouseEnter={() => {
        firstDelay.current = 1000;
        setHovered(true);
      }}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="card-image">
        <button className="image-open" onClick={onOpen} aria-label={`View ${p.title}`}>
          <span
            className="card-slide-track"
            style={{ transform: `translateX(-${activePhoto * 100}%)` }}
          >
            {images.map((image, index) => (
              <span className="card-slide" key={image} aria-hidden={index !== activePhoto}>
                <img
                  src={image}
                  alt={`${p.title}, photo ${index + 1} of ${images.length}`}
                  loading="lazy"
                />
              </span>
            ))}
          </span>
        </button>
        {featured && (
          <span className="card-badge">
            <Sparkles size={12} /> A LITTLE FAVORITE
          </span>
        )}
        <button
          className={`favorite ${favorite ? 'saved' : ''}`}
          onClick={onFavorite}
          aria-label={`${favorite ? 'Unsave' : 'Save'} ${p.title}`}
          aria-pressed={favorite}
        >
          <Heart size={17} fill={favorite ? 'currentColor' : 'none'} />
        </button>
        {images.length > 1 && (
          <div className="image-dots" role="group" aria-label={`${p.title} photos`}>
            {images.map((image, index) => (
              <button
                key={image}
                type="button"
                className={index === activePhoto ? 'active' : ''}
                aria-label={`Show photo ${index + 1} of ${p.title}`}
                aria-pressed={index === activePhoto}
                onClick={() => selectPhoto(index)}
              >
                <span />
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="card-body">
        <div className="card-neighborhood">
          <MapPin size={11} />
          {p.neighborhood}
          <span>NORTH CALOOCAN</span>
        </div>
        <button className="card-title" onClick={onOpen}>
          {p.title}
        </button>
        <p className="card-meta">
          {p.bedrooms === 0 ? 'Studio' : `${p.bedrooms} bedroom${p.bedrooms === 1 ? '' : 's'}`}
          <span>·</span>
          {p.capacity} guest{p.capacity === 1 ? '' : 's'}
          <span>·</span>
          {p.amenities.includes('Balcony')
            ? 'Private balcony'
            : p.amenities.includes('Pool')
              ? 'Pool access'
              : p.amenities.includes('Kitchen')
                ? 'Kitchen'
                : 'City stay'}
        </p>
        <div className="card-bottom">
          <div>
            <strong>{money(p.price)}</strong>
            <span> / night</span>
          </div>
          <button onClick={onOpen} className="card-arrow" aria-label={`Book ${p.title}`}>
            <ArrowRight size={18} />
          </button>
        </div>
      </div>
    </article>
  );
}

function BookingModal({
  property: p,
  data,
  user,
  filters,
  onClose,
  onBook,
  onMessage,
  onSignIn,
}: {
  property: Property;
  data: Data;
  user: User;
  filters: Filters;
  onClose: () => void;
  onBook: (input: {
    propertyId: string;
    checkIn: string;
    checkOut: string;
    guests: number;
  }) => Promise<boolean>;
  onMessage: () => Promise<void>;
  onSignIn: () => void;
}) {
  const [checkIn, setIn] = useState(filters.checkIn),
    [checkOut, setOut] = useState(filters.checkOut),
    [guests, setGuests] = useState(Math.min(filters.guests, p.capacity)),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [photo, setPhoto] = useState(p.image);
  const count = nights(checkIn, checkOut),
    valid = Number.isFinite(count) && count > 0;
  const occupied = data.reservations.filter(
    (r) => r.propertyId === p.id && r.status === 'confirmed' && r.checkOut > today(),
  );
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      validateBookingDates(checkIn, checkOut);
      await onBook({ propertyId: p.id, checkIn, checkOut, guests });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={p.title} onClose={onClose} wide>
      <div className="detail-layout">
        <div>
          <img className="detail-photo" src={photo} alt={`${p.title} apartment interior`} />
          <div className="gallery-thumbnails">
            {(p.images ?? [p.image]).map((image) => (
              <button
                key={image}
                type="button"
                onClick={() => setPhoto(image)}
                aria-label="View property photo"
              >
                <img src={image} alt="Property photo thumbnail" />
              </button>
            ))}
          </div>
          <div className="detail-location">
            <MapPin size={15} />
            {p.neighborhood}, North Caloocan
          </div>
          <p className="detail-address">{p.address}</p>
          <h3>A little room to feel at home.</h3>
          <p>{p.description}</p>
          <div className="detail-facts">
            <span>
              <Users size={17} />
              {p.capacity} guest{p.capacity === 1 ? '' : 's'}
            </span>
            <span>
              <BedDouble size={17} />
              {p.bedrooms === 0 ? 'Studio' : `${p.bedrooms} bedroom${p.bedrooms === 1 ? '' : 's'}`}
            </span>
          </div>
          <h3>The little comforts</h3>
          <div className="detail-amenities">
            {p.amenities.map((a) => (
              <span key={a}>
                <Check size={15} />
                {a}
              </span>
            ))}
          </div>
          <h3>House rules</h3>
          <p>{p.houseRules}</p>
          {p.checkInInstructions && (
            <>
              <h3>Check-in instructions</h3>
              <p>{p.checkInInstructions}</p>
            </>
          )}
          <h3>Guest reviews</h3>
          <div className="review-list">
            {data.reviews
              ?.filter((r) => r.propertyId === p.id && !r.hidden)
              .map((r) => (
                <article key={r.id}>
                  <strong>{r.rating}/5</strong>
                  <p>{r.body}</p>
                </article>
              ))}
            {!data.reviews?.some((r) => r.propertyId === p.id && !r.hidden) && (
              <p>No reviews yet.</p>
            )}
          </div>
          {user.role === 'guest' && (
            <button className="outline" type="button" onClick={() => void onMessage()}>
              <MessageCircle size={16} /> Message host
            </button>
          )}
          <h3>Find it in the neighborhood</h3>
          <StayMap properties={[p]} compact activeId={p.id} />
        </div>
        {user.role === 'guest' ? (
          <form className="booking-box" onSubmit={submit}>
            <h3>
              {money(p.price)} <small>/ night</small>
            </h3>
            <p>Stay up to 30 nights. Check in within 365 days from today.</p>
            <label>
              Check-in
              <input
                type="date"
                aria-label="Booking check-in"
                required
                min={today()}
                max={addDays(today(), 365)}
                value={checkIn}
                onChange={(e) => setIn(e.target.value)}
              />
            </label>
            <label>
              Checkout
              <input
                type="date"
                aria-label="Booking checkout"
                required
                min={addDays(checkIn || today(), 1)}
                max={addDays(checkIn || addDays(today(), 365), 30)}
                value={checkOut}
                onChange={(e) => setOut(e.target.value)}
              />
            </label>
            <label>
              Guests
              <select
                aria-label="Booking guests"
                value={guests}
                onChange={(e) => setGuests(Number(e.target.value))}
              >
                {Array.from({ length: p.capacity }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n} guest{n > 1 ? 's' : ''}
                  </option>
                ))}
              </select>
            </label>
            {valid && (
              <div className="price-breakdown">
                <span>
                  {money(p.price)} × {count} night{count > 1 ? 's' : ''}
                </span>
                <strong>{money(p.price * count)}</strong>
              </div>
            )}
            {valid && !available(p.id, checkIn, checkOut, data.reservations, data.calendar) && (
              <p className="field-error">These dates overlap an existing reservation.</p>
            )}
            {error && (
              <p role="alert" className="field-error">
                {error}
              </p>
            )}
            <button
              className="primary full-width"
              disabled={
                busy ||
                user.role !== 'guest' ||
                !p.published ||
                p.suspended ||
                user.id === 'visitor'
              }
            >
              {busy ? 'Reserving…' : 'Reserve this stay'} <ArrowRight size={16} />
            </button>
            <small className="booking-note">
              {user.role === 'guest'
                ? 'Instant confirmation. Payments are not handled here.'
                : 'Sign in with a guest account to book.'}
            </small>
            {user.id === 'visitor' && (
              <button className="outline full-width" type="button" onClick={onSignIn}>
                Sign in to book
              </button>
            )}
            <AvailabilityCalendar data={data} property={p} />
            {occupied.length > 0 && (
              <div className="occupied">
                <strong>Already reserved</strong>
                {occupied.map((r) => (
                  <span key={r.id}>
                    {formatDate(r.checkIn)} → {formatDate(r.checkOut)}
                  </span>
                ))}
                <small>Checkout dates are available for new check-ins.</small>
              </div>
            )}
          </form>
        ) : (
          <aside className="booking-box">
            <h3>
              {money(p.price)} <small>/ night</small>
            </h3>
            <p>
              {user.role === 'host'
                ? 'Manage this listing from your host dashboard.'
                : 'Reservations are available to guest accounts.'}
            </p>
            <AvailabilityCalendar data={data} property={p} />
          </aside>
        )}
      </div>
    </Modal>
  );
}

function PropertyEditor({
  property,
  onClose,
  onSave,
}: {
  property: Property;
  data: Data;
  user: User;
  onClose: () => void;
  onSave: (p: Property) => Promise<void>;
}) {
  const [draft, setDraft] = useState(property),
    [error, setError] = useState('');
  function field<K extends keyof Property>(key: K, value: Property[K]) {
    setDraft((p) => ({ ...p, [key]: value }));
  }
  const [saving, setSaving] = useState(false),
    [uploading, setUploading] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (saving || uploading) return;
    setError('');
    setSaving(true);
    try {
      await onSave(draft);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      title={property.title ? 'Edit your little space' : 'A new little space'}
      onClose={onClose}
      wide
    >
      <form onSubmit={submit} className="editor-form">
        <div className="form-row">
          <label>
            Property title
            <input
              required
              maxLength={80}
              value={draft.title}
              onChange={(e) => field('title', e.target.value)}
            />
          </label>
          <label>
            Neighborhood
            <select
              value={draft.neighborhood}
              onChange={(e) => field('neighborhood', e.target.value)}
            >
              {['Camarin', 'Deparo', 'Bagumbong', 'Tala', 'Bagong Silang'].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="form-row">
          <label>
            Address
            <input
              required
              maxLength={200}
              value={draft.address ?? ''}
              onChange={(e) => field('address', e.target.value)}
            />
          </label>
          <label>
            Property type
            <select
              value={draft.propertyType ?? 'Apartment'}
              onChange={(e) => field('propertyType', e.target.value)}
            >
              {['Studio', 'Apartment', 'House', 'Private room'].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
        </div>
        <label>
          House rules
          <textarea
            required
            maxLength={1500}
            value={draft.houseRules ?? ''}
            onChange={(e) => field('houseRules', e.target.value)}
          />
        </label>
        <label>
          Check-in instructions (shared with booked guests)
          <textarea
            required
            maxLength={1500}
            value={draft.checkInInstructions ?? ''}
            onChange={(e) => field('checkInInstructions', e.target.value)}
          />
        </label>
        <label>
          Description
          <textarea
            required
            maxLength={1500}
            rows={3}
            value={draft.description}
            onChange={(e) => field('description', e.target.value)}
          />
        </label>
        <div className="form-row three">
          <label>
            Nightly price (PHP)
            <input
              type="number"
              required
              min="1"
              max="100000"
              value={draft.price}
              onChange={(e) => field('price', Number(e.target.value))}
            />
          </label>
          <label>
            Guest capacity
            <input
              required
              type="number"
              min="1"
              max="20"
              value={draft.capacity}
              onChange={(e) => field('capacity', Number(e.target.value))}
            />
          </label>
          <label>
            Bedrooms (0 = studio)
            <input
              required
              type="number"
              min="0"
              max="10"
              value={draft.bedrooms}
              onChange={(e) => field('bedrooms', Number(e.target.value))}
            />
          </label>
        </div>
        <fieldset>
          <legend>Amenities</legend>
          <div className="amenity-options">
            {amenities.map((a) => (
              <label key={a}>
                <input
                  type="checkbox"
                  checked={draft.amenities.includes(a)}
                  onChange={() =>
                    field(
                      'amenities',
                      draft.amenities.includes(a)
                        ? draft.amenities.filter((v) => v !== a)
                        : [...draft.amenities, a],
                    )
                  }
                />
                {a}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>Choose a photo</legend>
          <div className="photo-options">
            {photos.map((p, i) => (
              <button
                key={p}
                type="button"
                className={draft.image === p ? 'active' : ''}
                onClick={() => {
                  field('image', p);
                  field('images', [p, ...(draft.images ?? []).filter((v) => v !== p)].slice(0, 8));
                }}
                aria-label={`Choose apartment photo ${i + 1}`}
                aria-pressed={draft.image === p}
              >
                <img src={p} alt={`Apartment option ${i + 1}`} />
                {draft.image === p && <CheckCircle2 size={20} />}
              </button>
            ))}
          </div>
        </fieldset>
        <label>
          Upload photos · JPEG, PNG, WebP · 4 MB each · up to 8
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            disabled={uploading}
            onChange={async (e) => {
              const files = Array.from(e.target.files ?? []);
              if (!files.length) return;
              if (files.length > 8) {
                setError('Choose up to eight photos.');
                return;
              }
              setUploading(true);
              setError('');
              try {
                const images = await uploadPhotos(files);
                field('images', images);
                field('image', images[0]);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setUploading(false);
              }
            }}
          />
        </label>
        <div className="gallery-thumbnails">
          {(draft.images ?? [draft.image]).map((image) => (
            <div className="gallery-item" key={image}>
              <button
                type="button"
                onClick={() => field('image', image)}
                aria-label="Use as cover photo"
              >
                <img src={image} alt="Listing photo" />
                {draft.image === image && <Check size={15} />}
              </button>
              <button
                type="button"
                className="text-button"
                aria-label="Remove photo"
                disabled={(draft.images ?? [draft.image]).length <= 1}
                onClick={() => {
                  const next = (draft.images ?? [draft.image]).filter((v) => v !== image);
                  field('images', next);
                  if (draft.image === image) field('image', next[0]);
                }}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <h3>Place it on the map</h3>
        <p className="muted-copy">
          Click inside the North Caloocan area or enter coordinates below.
        </p>
        <StayMap
          properties={[]}
          pin={{ lat: draft.lat, lng: draft.lng }}
          onPin={(p) => setDraft((d) => ({ ...d, ...p }))}
          editing
          compact
        />
        <div className="form-row">
          <label>
            Latitude
            <input
              required
              type="number"
              step="any"
              value={draft.lat}
              onChange={(e) => field('lat', Number(e.target.value))}
            />
          </label>
          <label>
            Longitude
            <input
              required
              type="number"
              step="any"
              value={draft.lng}
              onChange={(e) => field('lng', Number(e.target.value))}
            />
          </label>
        </div>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={draft.published}
            onChange={(e) => field('published', e.target.checked)}
          />{' '}
          Publish after admin approval
        </label>
        {draft.suspended && (
          <p className="field-error">
            An admin has suspended this listing. Saving or publishing will not lift the suspension.
          </p>
        )}
        {error && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="outline" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={saving || uploading}>
            {saving ? 'Saving…' : 'Save listing'} <Check size={16} />
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ReservationList({
  data,
  user,
  onCancel,
  onRefresh,
  onNotice,
}: {
  data: Data;
  user: User;
  onCancel: (id: string) => void;
  onRefresh: (data: Data) => void;
  onNotice: (text: string) => void;
}) {
  const [query, setQuery] = useState(''),
    [summaryId, setSummary] = useState<string | null>(null);
  const summary = data.reservations.find((r) => r.id === summaryId);
  const indexes = useMemo(() => buildIndexes(data), [data]);
  const all = data.reservations.filter(
    (r) =>
      user.role === 'admin' ||
      (user.role === 'guest'
        ? r.guestId === user.id
        : indexes.properties.get(r.propertyId)?.hostId === user.id),
  );
  const found = query.trim() ? indexes.references.get(query.trim().toUpperCase()) : undefined;
  const records = query.trim() ? all.filter((r) => r.id === found?.id) : all;
  return (
    <>
      {summary && (
        <Modal title="Booking summary" onClose={() => setSummary(null)}>
          <BookingSummary
            reservation={summary}
            property={data.properties.find((p) => p.id === summary.propertyId)}
            user={data.users.find((u) => u.id === summary.guestId)}
          />
        </Modal>
      )}
      <div className="section-heading reservation-heading">
        <h2>{user.role === 'guest' ? 'Your reservations' : 'Reservations'}</h2>
        <label className="reference-search">
          <Search size={16} />
          <input
            aria-label="Find booking reference"
            placeholder="Find booking reference"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      {!records.length ? (
        <div className="empty-state">
          <CalendarDays size={30} />
          <h3>
            {query
              ? 'No accessible booking with that reference.'
              : user.role === 'host'
                ? 'No guest reservations yet.'
                : user.role === 'admin'
                  ? 'No reservations yet.'
                  : 'Your next stay is waiting.'}
          </h3>
          <p>
            {query
              ? 'Try the exact booking reference, such as LS-DEMO0001.'
              : user.role === 'host'
                ? 'Guest reservations for your hosted properties will appear here.'
                : user.role === 'admin'
                  ? 'Reservations across all properties will appear here.'
                  : 'Confirmed and cancelled reservations will appear here.'}
          </p>
        </div>
      ) : (
        <div className="reservation-grid">
          {records.map((r) => {
            const p = indexes.properties.get(r.propertyId);
            const stayNights = nights(r.checkIn, r.checkOut);
            return (
              <article className="reservation-card" key={r.id}>
                <img src={p?.image ?? photos[0]} alt="" />
                <div className="reservation-content">
                  <div className="reservation-top">
                    <code>{r.reference}</code>
                    <span className={`status ${r.status}`}>{r.status}</span>
                  </div>
                  <h3>{p?.title ?? 'Unavailable property'}</h3>
                  <p>
                    {formatDate(r.checkIn)} → {formatDate(r.checkOut)}
                  </p>
                  <p>
                    {r.guests} guest{r.guests === 1 ? '' : 's'} · {stayNights} night
                    {stayNights === 1 ? '' : 's'}
                    {user.role !== 'guest' && ` · ${indexes.users.get(r.guestId)?.name ?? 'Guest'}`}
                  </p>
                  <div className="reservation-bottom">
                    <strong>{money(r.total)}</strong>
                    <button className="text-button" onClick={() => setSummary(r.id)}>
                      Booking summary
                    </button>
                    {user.role !== 'guest' &&
                      r.status === 'confirmed' &&
                      r.checkIn <= today() &&
                      r.checkOut > today() && (
                        <button
                          className="outline small"
                          onClick={async () => {
                            try {
                              onRefresh(
                                await change(`/bookings/${r.id}/status`, { status: 'checked-in' }),
                              );
                              onNotice('Guest checked in.');
                            } catch (e) {
                              onNotice((e as Error).message);
                            }
                          }}
                        >
                          Check in
                        </button>
                      )}
                    {user.role !== 'guest' && r.status === 'checked-in' && (
                      <button
                        className="outline small"
                        onClick={async () => {
                          try {
                            onRefresh(
                              await change(`/bookings/${r.id}/status`, { status: 'completed' }),
                            );
                            onNotice('Checkout recorded.');
                          } catch (e) {
                            onNotice((e as Error).message);
                          }
                        }}
                      >
                        Check out
                      </button>
                    )}
                    <small>Booked at {money(r.nightlyRate)}/night</small>
                    {r.status === 'confirmed' &&
                      (user.role === 'admin' ||
                        (user.role === 'guest' && r.checkIn >= today())) && (
                        <button className="text-button danger-text" onClick={() => onCancel(r.id)}>
                          Cancel booking
                        </button>
                      )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
export default App;
