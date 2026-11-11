import { useState, type ReactNode } from 'react';
import { MAX_PROFILES, PROFILE_NAME_MAX_LENGTH, profileSummary, type Profile } from '../../core/profiles';
import { TextField } from '../components/Controls';
import { Screen } from '../components/Screen';
import { Sheet } from '../components/Sheet';
import { app } from '../env';
import { useAppState } from '../hooks';
import { Icon } from '../icons';

function AddSheet({ onClose }: { onClose: () => void }): ReactNode {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const add = (): void => {
    const result = app.addProfile(name);
    if (result.ok) onClose();
    else setError(result.error);
  };
  return (
    <Sheet labelledBy="add-profile-title" onDismiss={onClose}>
      <h2 id="add-profile-title" className="sheet__title">
        Add a profile
      </h2>
      <TextField
        label="Name"
        medium
        autoFocus
        value={name}
        maxLength={PROFILE_NAME_MAX_LENGTH}
        placeholder="Their name"
        error={error}
        onChange={(value) => {
          setName(value);
          setError(null);
        }}
        onSubmit={add}
      />
      <p className="sheet__body">They start with the standard modes and can tune their own targets.</p>
      <button type="button" className="cta" onClick={add}>
        Add profile
      </button>
    </Sheet>
  );
}

function EditSheet({ profile, onClose }: { profile: Profile; onClose: () => void }): ReactNode {
  const [name, setName] = useState(profile.name);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const save = (): void => {
    const result = app.renameProfile(profile.id, name);
    if (result.ok) onClose();
    else setError(result.error);
  };
  const remove = async (): Promise<void> => {
    await app.deleteProfile(profile.id);
    onClose();
  };
  return (
    <Sheet labelledBy="edit-profile-title" onDismiss={onClose}>
      <h2 id="edit-profile-title" className="sheet__title">
        Edit profile
      </h2>
      <TextField
        label="Name"
        medium
        value={name}
        maxLength={PROFILE_NAME_MAX_LENGTH}
        error={error}
        onChange={(value) => {
          setName(value);
          setError(null);
        }}
        onSubmit={save}
      />
      <div className="stack" style={{ gap: 8 }}>
        <button type="button" className="cta" onClick={save}>
          Save
        </button>
        {profile.owner ? (
          <div className="note center">The owner profile stays with the hoodie.</div>
        ) : confirming ? (
          <button type="button" className="ghost link--danger" onClick={() => void remove()}>
            Remove {profile.name} and their modes
          </button>
        ) : (
          <button type="button" className="link link--danger" onClick={() => setConfirming(true)}>
            Remove this profile
          </button>
        )}
      </div>
    </Sheet>
  );
}

export function Profiles(): ReactNode {
  const profiles = useAppState((s) => s.profiles);
  const activeId = useAppState((s) => s.activeProfileId);
  const unit = useAppState((s) => s.settings.unit);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = profiles.find((p) => p.id === editingId) ?? null;
  const full = profiles.length >= MAX_PROFILES;

  return (
    <>
      <Screen title="Profiles" backTo="/settings" glow={{ size: 340, left: -120, top: 80, opacity: 0.6 }}>
        <p className="muted" style={{ fontSize: 15, lineHeight: 1.45 }}>
          One hoodie, a few people. Each profile keeps its own target, modes, and sensor history.
        </p>
        <div className="list" role="radiogroup" aria-label="Active profile">
          {profiles.map((profile) => {
            const on = profile.id === activeId;
            return (
              <div key={profile.id} style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={on}
                  className="item"
                  style={{ flex: '1 1 0', minWidth: 0 }}
                  onClick={() => void app.selectProfile(profile.id)}
                >
                  <span className="avatar" aria-hidden="true">
                    {profile.initials}
                  </span>
                  <span className="item__text">
                    <span className="item__title">{profile.name}</span>
                    <span className="item__sub">{profileSummary(profile, unit)}</span>
                  </span>
                  <span className="badge">{on ? 'Active' : profile.owner ? 'Owner' : ''}</span>
                </button>
                <button
                  type="button"
                  className="item"
                  style={{ width: 56, flex: '0 0 auto', padding: 0, justifyContent: 'center', color: 'var(--muted)' }}
                  aria-label={`Edit ${profile.name}`}
                  onClick={() => setEditingId(profile.id)}
                >
                  <Icon name="pencil" size={18} />
                </button>
              </div>
            );
          })}
        </div>
        {full ? (
          <div className="note center">This hoodie holds {MAX_PROFILES} profiles. Remove one to add another.</div>
        ) : (
          <button type="button" className="ghost" onClick={() => setAdding(true)}>
            <Icon name="plus" size={18} strokeWidth={2.5} /> Add a profile
          </button>
        )}
        <div className="note center">The hoodie switches profiles when a paired phone comes within range.</div>
      </Screen>
      {adding ? <AddSheet onClose={() => setAdding(false)} /> : null}
      {editing ? <EditSheet profile={editing} onClose={() => setEditingId(null)} /> : null}
    </>
  );
}
