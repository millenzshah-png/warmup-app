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
import { BUILT_IN_MODES } from '../../core/modes';
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
const GUARANTEE = 'Free shipping, 30-day returns and a 2-year warranty on the heating and cells.';

/** "Auto at 93°F, Sick at 95°F … and Sleep at 91°F", read from the built-in modes. */
const modeTemps = ((): string => {
  const parts = BUILT_IN_MODES.map((mode) => `${mode.name} at ${mode.targetF}°F`);
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1) ?? ''}`;
})();

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
            <p className="shop-muted">{GUARANTEE}</p>
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
            <h1>Heated hoodie that holds the temperature you set</h1>
            <p className="shop-lede">
              A sensor in the collar reads your skin, and three thin graphene panels heat to the temperature you pick in the Warmup app.
            </p>
            <div className="shop-hero__actions">
              <button type="button" className="shop-btn" onClick={() => scrollToSection('customize')}>
                Order a hoodie, from ${BASE_PRICE_USD}
              </button>
              <button type="button" className="shop-text-btn" onClick={() => scrollToSection('app')}>
                See the app
              </button>
            </div>
            <div className="shop-hero__photos">
              <figure className="shop-photo">
                <img src={IMAGES.shopBlackFront} alt="Oversized black heated hoodie, front view" />
                <img className="shop-photo__hem" src={IMAGES.hemLogo} alt="" />
              </figure>
              <figure className="shop-photo">
                <img src={IMAGES.shopBoneBack} alt="Bone heated hoodie, back view with the Orbit line-art print and Warmup logo" />
              </figure>
            </div>
          </div>
        </section>

        <section className="shop-wrap shop-section">
          <div className="shop-head">
            <h2>
              Warm like a jacket.
              <br />
              Wears like a hoodie.
            </h2>
            <p className="shop-lede">
              Three graphene panels, two {CELL_MASS_G} g cells and a collar sensor, inside a {GARMENT.fabric} hoodie.
            </p>
          </div>
          <div className="shop-grid3">
            <div className="shop-tile">
              <div className="shop-tile__num">{GARMENT.weightG} g</div>
              <h3>Keeps the weight off your back</h3>
              <p>That is size M with both cells in. The cells sit in the side seams, so nothing hangs on your back or pulls on a pocket.</p>
            </div>
            <div className="shop-tile">
              <div className="shop-tile__num">{GARMENT.zones} zones</div>
              <h3>Heats your chest and upper back</h3>
              <p>Left chest, right chest and upper back. Turn each panel on or off in the app.</p>
            </div>
            <div className="shop-tile">
              <div className="shop-tile__num">Up to {maxHours} h</div>
              <h3>Pulses heat when your skin cools</h3>
              <p>The collar sensor turns the panels on when your skin drops below your setting, so two full cells last up to {maxHours} hours on Low.</p>
            </div>
          </div>
        </section>

        <section className="shop-band shop-band--dark">
          <div className="shop-wrap shop-section shop-section--tall">
            <div className="shop-head">
              <h2>Two cells in the side seams</h2>
              <p className="shop-lede">
                Each cell snaps flush into a side seam at the waist on a magnetic connector. Snap both out and the hoodie goes in the washing machine.
              </p>
            </div>
            <div className="shop-grid3">
              <div className="shop-tile">
                <div className="shop-tile__num">{CELL_MASS_G} g</div>
                <h3>Balances the weight left and right</h3>
                <p>One cell on each side, so neither side pulls down.</p>
              </div>
              <div className="shop-tile">
                <div className="shop-tile__num">{mah} mAh</div>
                <h3>Swaps a cell in seconds</h3>
                <p>Pull a cell straight off its magnetic connector. There is no cable to unplug.</p>
              </div>
              <div className="shop-tile">
                <div className="shop-tile__num">1 or 2</div>
                <h3>Runs on one cell while the other charges</h3>
                <p>Charge one on the dock and keep wearing the hoodie. The app shows the charge of each cell.</p>
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
                <div className="shop-photo__label">{showBack ? 'Back, Orbit print on Bone' : `Front, ${color.name}`}</div>
              </div>
            </div>

            <div className="shop-config__options">
              <div className="shop-head shop-head--tight">
                <h2>Build your hoodie</h2>
                <p className="shop-muted shop-muted--large">Pick a color, a graphic and a size. Every version has the same panels, cells and app.</p>
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
                    See sizes
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
                  {added ? 'Added. See your bag' : 'Add to bag'}
                </button>
                <p className="shop-muted shop-center">{GUARANTEE}</p>
              </div>
            </div>
          </div>
        </section>

        <section id="app" className="shop-wrap shop-section shop-section--tall shop-split">
          <div className="shop-split__text">
            <h2>Five modes in the Warmup app</h2>
            <p className="shop-lede">
              Pick a mode and the hoodie holds its temperature: {modeTemps}. Commute warms the panels before you leave, and Sleep fades out on its
              own.
            </p>
            <ul className="shop-bullets">
              <li>Make your own modes next to the five built in</li>
              <li>Turn each panel on or off and see its temperature live</li>
              <li>See the time left and the charge of each cell</li>
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
              <h2>Made by two students in Palo Alto</h2>
              <p className="shop-lede">
                The heated hoodies we found were sold as work gear, with one heavy battery on one side and three heat settings. We wanted one we
                would wear to school, so we built Warmup around a skin sensor and two small cells.
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
              <p className="shop-muted">Henry M. Gunn High School, Palo Alto</p>
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
                  {GARMENT.zones} graphene film panels that cut off at {PANEL_LIMIT_F}°F
                </dd>
              </div>
              <div>
                <dt>Battery</dt>
                <dd>Two {mah} mAh snap-in cells, magnetic connector</dd>
              </div>
              <div>
                <dt>Runtime</dt>
                <dd>
                  {hours(0)} on Low, {hours(1)} on Medium, {hours(2)} on High
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
        <span>© 2026 Warmup</span>
        <Link to="/home">Open the app</Link>
      </footer>

      {bagOpen ? <BagPanel onClose={() => setBagOpen(false)} /> : null}
    </div>
  );
}
