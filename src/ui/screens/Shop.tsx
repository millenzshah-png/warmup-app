/**
 * The storefront: a customer-facing product page with a live configurator.
 * It is a full web page, not a phone screen, so it lays itself out for any
 * width from a phone to a wide monitor.
 */
import { useState, type ReactNode } from 'react';
import { homeStatus } from '../../core/app/selectors';
import { runtimeFromFullMin } from '../../core/battery/runtime';
import { bagCount, bagTotalUsd, lineTotalUsd, MAX_LINE_QUANTITY } from '../../core/shop/bag';
import {
  BASE_PRICE_USD,
  COLORS,
  GRAPHICS,
  POWER_OPTIONS,
  SHOP_SIZES,
  configurationSummary,
  defaultConfiguration,
  findColor,
  findGraphic,
  findPower,
  priceLabel,
  priceOf,
  type Configuration,
} from '../../core/shop/catalog';
import { CELL_CAPACITY_MAH, CELL_MASS_G, GARMENT, PANEL_LIMIT_F, RUNTIME_FROM_FULL_H } from '../../core/spec';
import { LEVEL_NAMES, type Level } from '../../core/types';
import { formatTemp } from '../../core/units';
import { app } from '../env';
import { useAppState } from '../hooks';
import { IMAGES, Icon } from '../icons';
import { Link } from '../router';

const SECTIONS: readonly { id: string; label: string }[] = [
  { id: 'top', label: 'Hoodie' },
  { id: 'customize', label: 'Customize' },
  { id: 'app', label: 'App' },
  { id: 'specs', label: 'Specs' },
  { id: 'story', label: 'Story' },
];

function scrollToSection(id: string): void {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

const hours = (level: Level): string => `${Number((runtimeFromFullMin(level) / 60).toFixed(1))} h`;
const maxHours = RUNTIME_FROM_FULL_H[0];
const mah = CELL_CAPACITY_MAH.toLocaleString('en-US');

function BagPanel({ onClose }: { onClose: () => void }): ReactNode {
  const bag = useAppState((s) => s.bag);
  const [notice, setNotice] = useState(false);
  return (
    <div
      className="shop-scrim"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="shop-bag" role="dialog" aria-modal="true" aria-labelledby="bag-title">
        <div className="shop-bag__head">
          <h2 id="bag-title">Your bag</h2>
          <button type="button" className="shop-icon-btn" aria-label="Close bag" onClick={onClose}>
            <Icon name="close" size={20} />
          </button>
        </div>
        {bag.length === 0 ? (
          <p className="shop-muted">Your bag is empty. Build a hoodie and it will show up here.</p>
        ) : (
          <ul className="shop-bag__lines">
            {bag.map((line) => (
              <li key={line.id} className="shop-bag__line">
                <span className="shop-swatch" style={{ background: findColor(line.config.color).hex }} aria-hidden="true" />
                <span className="shop-bag__text">
                  <b>Warmup hoodie</b>
                  <span className="shop-muted">{configurationSummary(line.config)}</span>
                  <span className="shop-muted">{findPower(line.config.power).name}</span>
                </span>
                <span className="shop-bag__side">
                  <b>${lineTotalUsd(line)}</b>
                  <span className="shop-qty">
                    <button type="button" aria-label="One fewer" onClick={() => app.setBagQuantity(line.id, line.quantity - 1)}>
                      −
                    </button>
                    <span aria-live="polite">{line.quantity}</span>
                    <button
                      type="button"
                      aria-label="One more"
                      disabled={line.quantity >= MAX_LINE_QUANTITY}
                      onClick={() => app.setBagQuantity(line.id, line.quantity + 1)}
                    >
                      +
                    </button>
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="shop-bag__foot">
          <div className="shop-bag__total">
            <span>Total</span>
            <b>${bagTotalUsd(bag)}</b>
          </div>
          <button type="button" className="shop-btn shop-btn--wide" disabled={bag.length === 0} onClick={() => setNotice(true)}>
            Check out
          </button>
          {notice ? (
            <p className="shop-muted" role="status">
              Checkout is not connected in this build. Your bag is saved on this device.
            </p>
          ) : (
            <p className="shop-muted">Free shipping · 30-day returns · 2-year warranty on heating and cells</p>
          )}
        </div>
      </div>
    </div>
  );
}

function LivePhone(): ReactNode {
  const telemetry = useAppState((s) => (s.link === 'connected' ? s.telemetry : null));
  const unit = useAppState((s) => s.settings.unit);
  const status = useAppState((s) => homeStatus(s).line);
  const level = telemetry?.power ? telemetry.level : null;
  return (
    <Link to="/home" className="shop-phone" aria-label="Open the app">
      <span className="shop-phone__screen">
        <img src={IMAGES.hoodieFront} alt="" />
        <span className="shop-phone__temp">{telemetry ? `${formatTemp(telemetry.skinC, unit)}°` : '--°'}</span>
        <span className="shop-phone__status">{telemetry ? status : 'Tap to open the app'}</span>
        <span className="shop-phone__seg" aria-hidden="true">
          {LEVEL_NAMES.map((name, index) => (
            <span key={name} data-on={index === level}>
              {name}
            </span>
          ))}
        </span>
      </span>
    </Link>
  );
}

export function Shop(): ReactNode {
  const [config, setConfig] = useState<Configuration>(defaultConfiguration);
  const [added, setAdded] = useState(false);
  const [bagOpen, setBagOpen] = useState(false);
  const count = useAppState((s) => bagCount(s.bag));

  const color = findColor(config.color);
  const graphic = findGraphic(config.graphic);
  const price = priceOf(config);
  const showBack = graphic.showsBack;

  const change = (patch: Partial<Configuration>): void => {
    setConfig((c) => ({ ...c, ...patch }));
    setAdded(false);
  };

  const add = (): void => {
    app.addToBag(config);
    setAdded(true);
  };

  return (
    <div className="shop" id="shop-scroll">
      <header className="shop-nav">
        <nav aria-label="Site" className="shop-nav__inner">
          <button type="button" className="shop-logo" onClick={() => scrollToSection('top')} aria-label="Warmup, back to top">
            <img src={IMAGES.logo} alt="" />
          </button>
          <div className="shop-nav__links">
            {SECTIONS.map((section) => (
              <button key={section.id} type="button" onClick={() => scrollToSection(section.id)}>
                {section.label}
              </button>
            ))}
          </div>
          <div className="shop-nav__actions">
            <Link to="/home" className="shop-nav__app">
              Open the app
            </Link>
            <button type="button" className="shop-btn shop-btn--small" onClick={() => setBagOpen(true)} aria-label={`Bag, ${count} ${count === 1 ? 'item' : 'items'}`}>
              <Icon name="bag" size={16} /> Bag{count > 0 ? ` · ${count}` : ''}
            </button>
          </div>
        </nav>
      </header>

      <main>
        <section id="top" className="shop-band shop-band--grey">
          <div className="shop-wrap shop-hero">
            <div className="shop-eyebrow">Comfort and style at the same time</div>
            <h1>
              Warm like a jacket.
              <br />
              Wears like a hoodie.
            </h1>
            <p className="shop-lede">
              Three graphene panels, two snap-in cells, and an app that holds the temperature you want. No orange stitching, no bulk. A hoodie you
              would wear with the heat off.
            </p>
            <div className="shop-hero__actions">
              <button type="button" className="shop-btn" onClick={() => scrollToSection('customize')}>
                Build yours · from ${BASE_PRICE_USD}
              </button>
              <button type="button" className="shop-text-btn" onClick={() => scrollToSection('app')}>
                See the app
              </button>
            </div>
            <div className="shop-hero__photos">
              <figure className="shop-photo">
                <img src={IMAGES.shopBlackFront} alt="Oversized black heated hoodie, front view" />
                <img className="shop-photo__hem" src={IMAGES.hemLogo} alt="" />
                <figcaption>Black · Plain</figcaption>
              </figure>
              <figure className="shop-photo">
                <img src={IMAGES.shopBoneBack} alt="Bone heated hoodie, back view with the Orbit line-art print and Warmup logo" />
                <figcaption>Bone · Orbit back print</figcaption>
              </figure>
            </div>
          </div>
        </section>

        <section className="shop-wrap shop-section">
          <div className="shop-grid3">
            <div className="shop-tile">
              <div className="shop-tile__num">{GARMENT.weightG} g</div>
              <h3>Lighter than a heated jacket</h3>
              <p>
                Graphene film panels and two {CELL_MASS_G} g cells at the waist keep the weight close to a normal heavyweight hoodie, with nothing on
                your back.
              </p>
            </div>
            <div className="shop-tile">
              <div className="shop-tile__num">{GARMENT.zones} zones</div>
              <h3>Heat where it matters</h3>
              <p>Chest left, chest right, and upper back. Each zone switches on or off from the app.</p>
            </div>
            <div className="shop-tile">
              <div className="shop-tile__num">Up to {maxHours} h</div>
              <h3>Smart runtime</h3>
              <p>
                The collar sensor reads your skin temperature and pulses heat only when you need it, so the cells last longer than a dumb dial.
              </p>
            </div>
          </div>
        </section>

        <section className="shop-band shop-band--dark">
          <div className="shop-wrap shop-section shop-section--tall">
            <div className="shop-head">
              <div className="shop-eyebrow shop-eyebrow--warm">Power</div>
              <h2>Two cells. Nothing on your back.</h2>
              <p className="shop-lede">
                One slim cell snaps flush into each side seam at the waist, held by a magnetic connector. Lie on your back, sleep in it, throw it in
                the wash. Snap the cells out and it is just a hoodie.
              </p>
            </div>
            <div className="shop-grid3">
              <div className="shop-tile">
                <div className="shop-tile__num">{CELL_MASS_G} g</div>
                <h3>Per cell, balanced left and right</h3>
                <p>Half the weight of a single pack on each side, where you never feel it.</p>
              </div>
              <div className="shop-tile">
                <div className="shop-tile__num">Snap</div>
                <h3>Magnetic connector</h3>
                <p>No cables to plug in. Pull a cell straight off and it disconnects cleanly.</p>
              </div>
              <div className="shop-tile">
                <div className="shop-tile__num">1 or 2</div>
                <h3>Runs on either cell</h3>
                <p>Charge one on the dock while the other keeps you warm. The app shows each cell on its own.</p>
              </div>
            </div>
          </div>
        </section>

        <section id="customize" className="shop-band shop-band--grey">
          <div className="shop-wrap shop-section shop-config">
            <div className="shop-config__preview">
              <div className="shop-photo shop-photo--preview">
                <img src={showBack ? IMAGES.shopBoneBack : IMAGES.shopBlackFront} alt="Your hoodie preview" />
                {showBack ? null : <img className="shop-photo__hem" src={IMAGES.hemLogo} alt="" />}
                {showBack ? null : <div className="shop-photo__tint" aria-hidden="true" style={{ background: color.tint }} />}
                {graphic.previewText ? (
                  <div className="shop-photo__art" style={{ color: color.ink }}>
                    {graphic.previewText}
                  </div>
                ) : null}
                <div className="shop-photo__label">{showBack ? 'Back · Orbit print, shown on Bone' : `Front · ${color.name}`}</div>
              </div>
            </div>

            <div className="shop-config__options">
              <div className="shop-head shop-head--tight">
                <h2>Build yours</h2>
                <p className="shop-muted shop-muted--large">Pick a color, a graphic, and a size. Plain or printed, the panels are the same.</p>
              </div>

              <div className="shop-option">
                <div className="shop-option__head">
                  <b id="opt-color">Color</b>
                  <span className="shop-muted">{color.name}</span>
                </div>
                <div className="shop-swatches" role="radiogroup" aria-labelledby="opt-color">
                  {COLORS.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      role="radio"
                      aria-checked={config.color === c.id}
                      aria-label={c.name}
                      className="shop-swatch shop-swatch--pick"
                      style={{ background: c.hex }}
                      onClick={() => change({ color: c.id })}
                    />
                  ))}
                </div>
              </div>

              <div className="shop-option">
                <div className="shop-option__head">
                  <b id="opt-graphic">Graphic</b>
                  <span className="shop-muted">{priceLabel(graphic.priceUsd)}</span>
                </div>
                <div className="shop-cards" role="radiogroup" aria-labelledby="opt-graphic">
                  {GRAPHICS.map((g) => (
                    <button key={g.id} type="button" role="radio" aria-checked={config.graphic === g.id} className="shop-card" onClick={() => change({ graphic: g.id })}>
                      <b>{g.name}</b>
                      <span className="shop-muted">{g.detail}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="shop-option">
                <div className="shop-option__head">
                  <b id="opt-size">Size</b>
                  <button type="button" className="shop-text-btn shop-text-btn--inline" onClick={() => scrollToSection('specs')}>
                    Size guide
                  </button>
                </div>
                <div className="shop-sizes" role="radiogroup" aria-labelledby="opt-size">
                  {SHOP_SIZES.map((size) => (
                    <button key={size} type="button" role="radio" aria-checked={config.size === size} className="shop-size" onClick={() => change({ size })}>
                      {size}
                    </button>
                  ))}
                </div>
              </div>

              <div className="shop-option">
                <div className="shop-option__head">
                  <b id="opt-power">Power</b>
                </div>
                <div className="shop-cards shop-cards--stack" role="radiogroup" aria-labelledby="opt-power">
                  {POWER_OPTIONS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      role="radio"
                      aria-checked={config.power === p.id}
                      className="shop-card shop-card--row"
                      onClick={() => change({ power: p.id })}
                    >
                      <span className="shop-card__text">
                        <b>{p.name}</b>
                        <span className="shop-muted">{p.detail}</span>
                      </span>
                      <b>{priceLabel(p.priceUsd)}</b>
                    </button>
                  ))}
                </div>
              </div>

              <div className="shop-summary">
                <div className="shop-summary__row">
                  <span className="shop-muted shop-muted--large">{configurationSummary(config)}</span>
                  <span className="shop-summary__price" aria-live="polite">
                    ${price.totalUsd}
                  </span>
                </div>
                <button type="button" className="shop-btn shop-btn--wide" data-added={added} onClick={added ? () => setBagOpen(true) : add}>
                  {added ? 'Added. View bag' : 'Add to bag'}
                </button>
                <p className="shop-muted shop-center">Free shipping · 30-day returns · 2-year warranty on heating and cells</p>
              </div>
            </div>
          </div>
        </section>

        <section id="app" className="shop-wrap shop-section shop-section--tall shop-split">
          <div className="shop-split__text">
            <div className="shop-eyebrow">The app</div>
            <h2>Set it and forget it.</h2>
            <p className="shop-lede">
              Pick a mode and the hoodie holds your temperature. Sick mode for the day you feel rough. Commute mode preheats before you walk out.
              Sleep mode fades out on its own. The regulation never switches off; it just pulses less when you are already warm.
            </p>
            <ul className="shop-bullets">
              <li>Auto, Sick, Commute, Outdoor, and Sleep modes</li>
              <li>Per-zone control and live panel temperatures</li>
              <li>Runtime estimate and both cells, shown separately</li>
            </ul>
          </div>
          <div className="shop-split__art">
            <LivePhone />
          </div>
        </section>

        <section id="story" className="shop-band shop-band--grey">
          <div className="shop-wrap shop-section shop-section--tall shop-split">
            <div className="shop-split__art">
              <div className="shop-photo shop-photo--story">
                <img src={IMAGES.shopBoneBack} alt="Bone Warmup hoodie, back view" />
              </div>
            </div>
            <div className="shop-split__text">
              <div className="shop-eyebrow">Our story</div>
              <h2>
                Started in Palo Alto.
                <br />
                Built for cold mornings.
              </h2>
              <p className="shop-lede">
                Every heated hoodie we could buy was heavy, boxy, and stitched in orange. We wanted the warmth without giving up the look, so we
                built one that reads your body temperature and still looks like something you would wear.
              </p>
              <div className="shop-founders">
                <div>
                  <b>Dan Huang</b>
                  <span className="shop-muted">Co-founder</span>
                </div>
                <div>
                  <b>Millen Shah</b>
                  <span className="shop-muted">Co-founder</span>
                </div>
              </div>
              <p className="shop-muted">Henry M. Gunn High School · 780 Arastradero Road, Palo Alto, CA 94306</p>
            </div>
          </div>
        </section>

        <section id="specs" className="shop-band shop-band--dark">
          <div className="shop-wrap shop-section">
            <div className="shop-specs__head">
              <h2>Specs</h2>
              <img src={IMAGES.hemLogo} alt="Warmup" />
            </div>
            <dl className="shop-specs">
              <div>
                <dt>Heating</dt>
                <dd>
                  {GARMENT.zones} graphene film zones, {PANEL_LIMIT_F}°F cap
                </dd>
              </div>
              <div>
                <dt>Battery</dt>
                <dd>Two {mah} mAh snap-in cells, magnetic connector</dd>
              </div>
              <div>
                <dt>Runtime</dt>
                <dd>
                  {hours(0)} Low · {hours(1)} Medium · {hours(2)} High
                </dd>
              </div>
              <div>
                <dt>Fabric</dt>
                <dd>{GARMENT.fabric}</dd>
              </div>
              <div>
                <dt>Weight</dt>
                <dd>{GARMENT.weightG} g with both cells, size M</dd>
              </div>
              <div>
                <dt>Connectivity</dt>
                <dd>Bluetooth LE, iOS and Android</dd>
              </div>
              <div>
                <dt>Care</dt>
                <dd>Machine washable with the cells snapped out</dd>
              </div>
              <div>
                <dt>Sizes</dt>
                <dd>XS to XXL, unisex fit</dd>
              </div>
            </dl>
          </div>
        </section>
      </main>

      <footer className="shop-wrap shop-footer">
        <span>© 2026 Warmup · Comfort and style at the same time</span>
        <Link to="/home">Open the app</Link>
      </footer>

      {bagOpen ? <BagPanel onClose={() => setBagOpen(false)} /> : null}
    </div>
  );
}
