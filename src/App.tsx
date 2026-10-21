import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  ArrowDownUp,
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
  RotateCcw,
  CheckCircle2,
} from 'lucide-react';
import StayMap from './components/StayMap';
import Modal from './components/Modal';
import AlgorithmLab from './components/AlgorithmLab';
import { locateCell, project, voronoi } from './lib/algorithms';
import {
  amenities,
  available,
  buildIndexes,
  cancelBooking,
  createBooking,
  findProperties,
  money,
  nights,
  saveProperty,
  today,
  toggleSuspension,
  validateDates,
  type Data,
  type Filters,
  type Property,
  type User,
} from './lib/model';
import { photos, seedData } from './lib/seed';
import { loadData, persistData } from './lib/storage';

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
  const [initial] = useState(loadData),
    [data, setData] = useState<Data>(initial.data),
    [userId, setUserId] = useState('guest-1');
  const [page, setPage] = useState(() => window.location.hash.slice(1) || 'explore');
  const [filters, setFilters] = useState<Filters>(defaultFilters),
    [filtersOpen, setFiltersOpen] = useState(false),
    [mapOpen, setMapOpen] = useState(false),
    [overlay, setOverlay] = useState(false);
  const [activeId, setActiveId] = useState<string>(),
    [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [detail, setDetail] = useState<string | null>(null),
    [editing, setEditing] = useState<Property | null>(null),
    [notice, setNotice] = useState(initial.warning);
  const [confirmation, setConfirmation] = useState<{
    title: string;
    body: string;
    action: () => void;
  } | null>(null);
  const [favorites, setFavorites] = useState<string[]>([]),
    [category, setCategory] = useState('All stays');
  const indexes = useMemo(() => buildIndexes(data), [data]);
  const user = indexes.users.get(userId) ?? data.users[0];
  const results = useMemo(() => findProperties(data, filters), [data, filters]);
  const properties = useMemo(() => results.map((r) => r.property), [results]);
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
  function commit(next: Data, message: string) {
    try {
      persistData(next);
    } catch {
      setNotice('Browser storage is unavailable or full. Your change was not saved.');
      return false;
    }
    setData(next);
    setNotice(message);
    return true;
  }
  function perform(action: () => Data, message: string) {
    try {
      return commit(action(), message);
    } catch (e) {
      setNotice((e as Error).message);
      return false;
    }
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
      neighborhood: 'Salcedo Village',
      description: '',
      price: 2500,
      capacity: 2,
      bedrooms: 1,
      amenities: ['WiFi', 'Air conditioning'],
      lat: 14.558,
      lng: 121.024,
      image: photos[0],
      published: false,
      suspended: false,
    });
  }
  return (
    <>
      <header className="site-header">
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
          <button
            className={page === 'explore' ? 'active' : ''}
            onClick={() => navigate('explore')}
          >
            Find a stay
          </button>
          <button
            className={page === 'dashboard' ? 'active' : ''}
            onClick={() => navigate('dashboard')}
          >
            {dashboard}
          </button>
          <button className={page === 'lab' ? 'active' : ''} onClick={() => navigate('lab')}>
            <FlaskConical size={15} /> Algorithm lab
          </button>
        </nav>
        <div className="account">
          <span className="demo-pill">LOCAL DEMO</span>
          <div className="avatar">
            {user.name
              .split(' ')
              .map((n) => n[0])
              .join('')}
          </div>
          <label className="account-select">
            <span className="sr-only">Demo account</span>
            <select
              aria-label="Demo account"
              value={user.id}
              onChange={(e) => {
                setUserId(e.target.value);
                setDetail(null);
                setEditing(null);
              }}
            >
              {data.users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} · {u.role}
                </option>
              ))}
            </select>
            <ChevronDown size={14} />
            <small>{user.role} account</small>
          </label>
        </div>
      </header>
      <main>
        {page === 'explore' && (
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
                  <br className="desktop-break" /> Find your kind of stay, right here in Makati.
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
                    <MapPin size={14} /> SALCEDO VILLAGE, MAKATI
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
              role="search"
              aria-label="Find a property"
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
              <div className="search-heading">
                <span>Find your next stay</span>
                <small>Search by name, neighborhood, or amenity</small>
              </div>
              <label className="search-location">
                <Search size={23} />
                <span>
                  <b>Search stays</b>
                  <input
                    aria-label="Search properties and amenities"
                    placeholder="Try balcony or Salcedo"
                    maxLength={120}
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
                    {[1, 2, 3, 4, 5, 6].map((n) => (
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
                    {properties.length} thoughtfully chosen stays in Makati
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
                      onSelect={setActiveId}
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
                            onFavorite={() =>
                              setFavorites((f) =>
                                f.includes(nearest.id)
                                  ? f.filter((v) => v !== nearest.id)
                                  : [...f, nearest.id],
                              )
                            }
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
                          onFavorite={() =>
                            setFavorites((f) =>
                              f.includes(activeId)
                                ? f.filter((v) => v !== activeId)
                                : [...f, activeId],
                            )
                          }
                        />
                      ) : (
                        <>
                          <MapPin size={32} />
                          <h3>Your next stay is a pin away.</h3>
                          <p>
                            Choose a property marker for details, or click inside the demo area to
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
                  {properties.map((p, i) => (
                    <PropertyCard
                      key={p.id}
                      property={p}
                      onOpen={() => setDetail(p.id)}
                      favorite={favorites.includes(p.id)}
                      onFavorite={() =>
                        setFavorites((f) =>
                          f.includes(p.id) ? f.filter((v) => v !== p.id) : [...f, p.id],
                        )
                      }
                      featured={i === 0 && !filters.query}
                    />
                  ))}
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
        {page === 'dashboard' && (
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
                      : 'Oversee demo accounts, listings, and reservations.'}
                </p>
              </div>
              {user.role === 'host' && (
                <button className="primary" onClick={newProperty}>
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
            {user.role !== 'guest' && (
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
                                className={`status ${p.suspended ? 'cancelled' : p.published ? 'confirmed' : 'draft'}`}
                              >
                                {p.suspended ? 'Suspended' : p.published ? 'Published' : 'Draft'}
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
                                      Edit
                                    </button>
                                    <button
                                      className="text-button"
                                      onClick={() =>
                                        perform(
                                          () =>
                                            saveProperty(data, user, {
                                              ...p,
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
                                  <button
                                    className={`outline small ${p.suspended ? '' : 'danger-text'}`}
                                    onClick={() =>
                                      perform(
                                        () => toggleSuspension(data, user, p.id),
                                        p.suspended
                                          ? 'Listing restored.'
                                          : 'Listing suspended. Existing bookings are preserved.',
                                      )
                                    }
                                  >
                                    {p.suspended ? 'Restore' : 'Suspend'}
                                  </button>
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
            <ReservationList
              data={data}
              user={user}
              onCancel={(id) =>
                setConfirmation({
                  title: 'Cancel this reservation?',
                  body: 'These dates will become available again. No payment or refund is involved in this demo.',
                  action: () =>
                    perform(
                      () => cancelBooking(data, user, id),
                      'Reservation cancelled. The dates are available again.',
                    ),
                })
              }
            />
            {user.role === 'admin' && (
              <>
                <h2 className="dashboard-heading">Demo accounts</h2>
                <div className="user-grid">
                  {data.users.map((u) => (
                    <div className="user-card" key={u.id}>
                      <span className="avatar">
                        {u.name
                          .split(' ')
                          .map((n) => n[0])
                          .join('')}
                      </span>
                      <div>
                        <strong>{u.name}</strong>
                        <small>{u.id}</small>
                      </div>
                      <span className="badge">{u.role}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        )}
        {page === 'lab' && <AlgorithmLab data={labData} properties={properties} />}
        {!['explore', 'dashboard', 'lab'].includes(page) && (
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
          <span className="footer-demo">
            <span /> Fictional listings · Local prototype
          </span>
          <button
            className="text-button"
            onClick={() =>
              setConfirmation({
                title: 'Start fresh?',
                body: 'This resets all properties and bookings to the original fictional demo. Your local changes will be removed.',
                action: () => {
                  if (commit(seedData(), 'Demo reset. A fresh start is ready.')) {
                    setUserId('guest-1');
                    setFilters(defaultFilters);
                    setCategory('All stays');
                    setPin(null);
                    setFavorites([]);
                    setActiveId(undefined);
                    navigate('explore');
                  }
                },
              })
            }
          >
            <RotateCcw size={13} /> Reset demo
          </button>
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
          onBook={(input) => {
            try {
              const next = createBooking(data, user, input);
              if (!commit(next, `You're booked! Reference: ${next.reservations[0].reference}`))
                return false;
              setDetail(null);
              navigate('dashboard');
              return true;
            } catch (e) {
              throw e;
            }
          }}
        />
      )}
      {editing && (
        <PropertyEditor
          property={editing}
          data={data}
          user={user}
          onClose={() => setEditing(null)}
          onSave={(property) => {
            const next = saveProperty(data, user, property);
            if (commit(next, 'Your listing has been saved.')) setEditing(null);
            else
              throw new Error(
                'Your listing could not be saved. Browser storage may be unavailable or full.',
              );
          }}
        />
      )}
      {confirmation && (
        <Modal title={confirmation.title} onClose={() => setConfirmation(null)}>
          <p>{confirmation.body}</p>
          <div className="modal-actions">
            <button className="outline" onClick={() => setConfirmation(null)}>
              Keep it as is
            </button>
            <button
              className="primary"
              onClick={() => {
                confirmation.action();
                setConfirmation(null);
              }}
            >
              Confirm
            </button>
          </div>
        </Modal>
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
  return (
    <article className="property-card">
      <div className="card-image">
        <button className="image-open" onClick={onOpen} aria-label={`View ${p.title}`}>
          <img src={p.image} alt={`${p.title}, a furnished demo apartment`} loading="lazy" />
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
        <span className="image-dots">
          <i />
          <i />
          <i />
        </span>
      </div>
      <div className="card-body">
        <div className="card-neighborhood">
          <MapPin size={11} />
          {p.neighborhood}
          <span>MAKATI</span>
        </div>
        <button className="card-title" onClick={onOpen}>
          {p.title}
        </button>
        <p className="card-meta">
          {p.bedrooms === 0 ? 'Studio' : `${p.bedrooms} bedroom`}
          <span>·</span>
          {p.capacity} guests<span>·</span>
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
  }) => boolean;
}) {
  const [checkIn, setIn] = useState(filters.checkIn),
    [checkOut, setOut] = useState(filters.checkOut),
    [guests, setGuests] = useState(Math.min(filters.guests, p.capacity)),
    [error, setError] = useState('');
  const count = nights(checkIn, checkOut),
    valid = Number.isFinite(count) && count > 0;
  const occupied = data.reservations.filter(
    (r) => r.propertyId === p.id && r.status === 'confirmed' && r.checkOut > today(),
  );
  function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      if (!onBook({ propertyId: p.id, checkIn, checkOut, guests }))
        setError('Your booking could not be saved. Browser storage may be unavailable or full.');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Modal title={p.title} onClose={onClose} wide>
      <div className="detail-layout">
        <div>
          <img className="detail-photo" src={p.image} alt={`${p.title} apartment interior`} />
          <div className="detail-location">
            <MapPin size={15} />
            {p.neighborhood}, Makati
          </div>
          <h3>A little room to feel at home.</h3>
          <p>{p.description}</p>
          <div className="detail-facts">
            <span>
              <Users size={17} />
              {p.capacity} guests
            </span>
            <span>
              <BedDouble size={17} />
              {p.bedrooms === 0 ? 'Studio' : `${p.bedrooms} bedroom`}
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
          <h3>Find it in the neighborhood</h3>
          <StayMap properties={[p]} compact activeId={p.id} />
        </div>
        <form className="booking-box" onSubmit={submit}>
          <h3>
            {money(p.price)} <small>/ night</small>
          </h3>
          <p>No hidden fees. Just your little stay.</p>
          <label>
            Check-in
            <input
              type="date"
              aria-label="Booking check-in"
              required
              min={today()}
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
              min={checkIn || today()}
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
          {valid && !available(p.id, checkIn, checkOut, data.reservations) && (
            <p className="field-error">These dates overlap an existing reservation.</p>
          )}
          {error && (
            <p role="alert" className="field-error">
              {error}
            </p>
          )}
          <button
            className="primary full-width"
            disabled={user.role !== 'guest' || !p.published || p.suspended}
          >
            Reserve this stay <ArrowRight size={16} />
          </button>
          <small className="booking-note">
            {user.role === 'guest'
              ? 'Instant confirmation. No payment required.'
              : 'Switch to a guest demo account to book.'}
          </small>
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
  onSave: (p: Property) => void;
}) {
  const [draft, setDraft] = useState(property),
    [error, setError] = useState('');
  function field<K extends keyof Property>(key: K, value: Property[K]) {
    setDraft((p) => ({ ...p, [key]: value }));
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      onSave(draft);
    } catch (e) {
      setError((e as Error).message);
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
            <input
              required
              maxLength={60}
              value={draft.neighborhood}
              onChange={(e) => field('neighborhood', e.target.value)}
            />
          </label>
        </div>
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
                onClick={() => field('image', p)}
                aria-label={`Choose apartment photo ${i + 1}`}
                aria-pressed={draft.image === p}
              >
                <img src={p} alt={`Apartment option ${i + 1}`} />
                {draft.image === p && <CheckCircle2 size={20} />}
              </button>
            ))}
          </div>
        </fieldset>
        <h3>Place it on the map</h3>
        <p className="muted-copy">Click inside the Makati area or enter coordinates below.</p>
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
          Publish listing immediately
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
          <button className="primary">
            Save listing <Check size={16} />
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
}: {
  data: Data;
  user: User;
  onCancel: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
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
            {query ? 'No accessible booking with that reference.' : 'Your next stay is waiting.'}
          </h3>
          <p>
            {query
              ? 'Try the exact booking reference, such as LS-DEMO0001.'
              : 'Confirmed and cancelled reservations will appear here.'}
          </p>
        </div>
      ) : (
        <div className="reservation-grid">
          {records.map((r) => {
            const p = indexes.properties.get(r.propertyId);
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
                    {r.guests} guests · {nights(r.checkIn, r.checkOut)} nights
                    {user.role !== 'guest' && ` · ${indexes.users.get(r.guestId)?.name ?? 'Guest'}`}
                  </p>
                  <div className="reservation-bottom">
                    <strong>{money(r.total)}</strong>
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
