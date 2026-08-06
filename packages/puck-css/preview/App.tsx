import React, { useState } from 'react';
import '@pantheon-systems/pds-toolkit-react/dist/css/pds-core.css';
import '../src/pds/theme/PuckEditorTheme.css';
import { AgentChip } from '../src/pds/components/AgentChip';
import { DocStateBadge } from '../src/pds/components/DocStateBadge';
import { P1EditorHeader } from '../src/pds/components/P1EditorHeader';
import { P1EditorSubheader } from '../src/pds/components/P1EditorSubheader';
import { PageNavigator } from '../src/pds/components/PageNavigator';
import { PresenceStack } from '../src/pds/components/PresenceStack';
import { PublishControl } from '../src/pds/components/PublishControl';
import { WorkstreamSwitcher } from '../src/pds/components/WorkstreamSwitcher';
import type { DocState } from '../src/pds/types';
import type { PageNavigatorDocument } from '../src/pds/components/PageNavigator';

const BRANCHES = [
  { id: 'main', siteId: 's1', name: 'main', isMain: true, status: 'active' as const, sourceBranchId: null, sourceCheckpointId: null, createdById: 'u1', createdByType: 'user' as const, createdAt: '2025-01-01T00:00:00Z' },
  { id: 'feat-hero', siteId: 's1', name: 'feat/hero-redesign', isMain: false, status: 'active' as const, sourceBranchId: 'main', sourceCheckpointId: 'cp1', createdById: 'u1', createdByType: 'user' as const, createdAt: '2025-03-15T00:00:00Z' },
  { id: 'feat-nav', siteId: 's1', name: 'feat/navigation-v2', isMain: false, status: 'active' as const, sourceBranchId: 'main', sourceCheckpointId: 'cp2', createdById: 'u2', createdByType: 'user' as const, createdAt: '2025-04-01T00:00:00Z' },
];

const DOCUMENTS: PageNavigatorDocument[] = [
  { id: 'd1', path: '/home', archived: false, isPublished: true, inherited: false },
  { id: 'd2', path: '/about', archived: false, isPublished: true, inherited: true },
  { id: 'd3', path: '/blog', archived: false, isPublished: false, inherited: false },
  { id: 'd4', path: '/blog/hello-world', archived: false, isPublished: true, inherited: false },
  { id: 'd5', path: '/contact', archived: false, isPublished: false, inherited: false },
  { id: 'd6', path: '/pricing', archived: false, isPublished: true, inherited: true },
  { id: 'd7', path: '/docs/getting-started', archived: false, isPublished: true, inherited: false },
];

const SITE_MENU_ITEMS = [
  { label: 'Code view', iconName: 'squareCode', callback: () => console.log('Code view') },
  { label: 'Site settings', iconName: 'gear', callback: () => console.log('Site settings') },
  { label: 'Environments', iconName: 'server', callback: () => console.log('Environments') },
];

const AGENTS = [
  { id: 'a1', name: 'Layout Agent', isAgent: true },
  { id: 'a2', name: 'Content Writer', isAgent: true },
];

const HUMAN_ACTORS = [
  { id: 'h1', name: 'Alice Johnson', isAgent: false },
  { id: 'h2', name: 'Bob Smith', isAgent: false },
  { id: 'h3', name: 'Carol Danvers', isAgent: false },
  { id: 'h4', name: 'Dave Park', isAgent: false },
  { id: 'h5', name: 'Eve Wilson', isAgent: false },
];

const PRESENCE_ACTORS = HUMAN_ACTORS.map((a) => ({
  id: a.id,
  actorId: a.id,
  actorType: 'user' as const,
  role: 'human' as const,
  name: a.name,
  state: 'active' as const,
  lastActivityAt: new Date().toISOString(),
  joinedAt: new Date().toISOString(),
}));

const AGENT_CHIPS = [
  {
    id: 'agent-1',
    name: 'Layout Agent',
    initials: 'LA',
    gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    intent: 'Reorganizing hero section',
    progress: '65%',
    workstream: 'feat/hero-redesign',
  },
  {
    id: 'agent-2',
    name: 'Content Writer',
    initials: 'CW',
    gradient: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
    intent: 'Drafting blog post',
    workstream: 'main',
  },
  {
    id: 'agent-3',
    name: 'SEO Optimizer',
    initials: 'SO',
    gradient: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
    intent: 'Analyzing meta tags',
    progress: '90%',
    workstream: 'feat/hero-redesign',
  },
];

const DOC_STATES: DocState[] = ['modified', 'unpublished', 'live', 'liveOnly'];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: '3rem' }}>
      <h2 style={{ fontFamily: 'var(--pds-typography-ff-default, Inter, sans-serif)', fontSize: '1.25rem', fontWeight: 600, marginBottom: '1rem', borderBottom: '1px solid var(--pds-color-border-default, #e0e0e0)', paddingBottom: '0.5rem' }}>{title}</h2>
      {children}
    </section>
  );
}

function SubSection({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '1.5rem' }}>
      {label && <h3 style={{ fontFamily: 'var(--pds-typography-ff-default, Inter, sans-serif)', fontSize: '0.875rem', fontWeight: 500, color: '#666', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</h3>}
      {children}
    </div>
  );
}

export default function App() {
  const [currentBranch, setCurrentBranch] = useState(BRANCHES[1]);
  const [currentDoc, setCurrentDoc] = useState(DOCUMENTS[0]);
  const [pageNavOpen, setPageNavOpen] = useState(false);

  const noop = () => {};
  const log = (msg: string) => () => console.log(msg);

  return (
    <div className="puck-editor-theme" style={{ minHeight: '100vh', background: 'var(--pds-color-bg-default, #fff)' }}>
      {/* Full-width composed header + subheader */}
      <Section title="P1EditorHeader (full width, composed)">
        <div style={{ border: '1px solid var(--pds-color-border-default, #e0e0e0)', borderRadius: 8 }}>
          <P1EditorHeader
            branches={BRANCHES}
            currentBranch={currentBranch}
            documents={DOCUMENTS}
            currentDocument={currentDoc}
            currentUser={{ id: 'user-42' }}
            collaborators={PRESENCE_ACTORS}
            siteName="acme-marketing"
            siteMenuItems={SITE_MENU_ITEMS}
            onSwitchBranch={(id) => {
              const b = BRANCHES.find((br) => br.id === id);
              if (b) setCurrentBranch(b);
            }}
            onSelectDocument={(doc) => setCurrentDoc(doc)}
            onCompareWithLive={log('Compare with Live clicked')}
            onLogout={log('Logout clicked')}
          />
        </div>
      </Section>

      <Section title="P1EditorSubheader — modified on branch">
        <div style={{ border: '1px solid var(--pds-color-border-default, #e0e0e0)', borderRadius: 8 }}>
          <P1EditorSubheader
            puckActions={<span style={{ fontSize: '0.75rem', color: '#999', padding: '0 0.5rem' }}>[Puck actions slot]</span>}
            docState="modified"
            context="branch"
            agents={AGENTS}
            onStopAgent={(id) => console.log('Stop agent:', id)}
            onPublish={log('Publish to live clicked')}
            hasPast={true}
            hasFuture={false}
            onUndo={log('Undo')}
            onRedo={log('Redo')}
          />
        </div>
      </Section>

      <Section title="P1EditorSubheader — unpublished on main">
        <div style={{ border: '1px solid var(--pds-color-border-default, #e0e0e0)', borderRadius: 8 }}>
          <P1EditorSubheader
            puckActions={<span style={{ fontSize: '0.75rem', color: '#999', padding: '0 0.5rem' }}>[Puck actions slot]</span>}
            docState="unpublished"
            context="main"
            agents={[]}
            onStopAgent={noop}
            onPublish={log('Publish clicked')}
            onCreateWorkstream={log('Create workstream clicked')}
            hasPast={false}
            hasFuture={false}
            onUndo={log('Undo')}
            onRedo={log('Redo')}
          />
        </div>
      </Section>

      <Section title="P1EditorSubheader — live on branch (badge only)">
        <div style={{ border: '1px solid var(--pds-color-border-default, #e0e0e0)', borderRadius: 8 }}>
          <P1EditorSubheader
            puckActions={<span style={{ fontSize: '0.75rem', color: '#999', padding: '0 0.5rem' }}>[Puck actions slot]</span>}
            docState="live"
            context="branch"
            agents={[]}
            onStopAgent={noop}
            hasPast={false}
            hasFuture={false}
            onUndo={log('Undo')}
            onRedo={log('Redo')}
          />
        </div>
      </Section>

      <div style={{ padding: '2rem', maxWidth: 1200, margin: '0 auto' }}>
        <h1 style={{ fontFamily: 'var(--pds-typography-ff-default, Inter, sans-serif)', fontSize: '1.75rem', fontWeight: 700, marginBottom: '2rem' }}>PDS Component Preview</h1>

        <Section title="DocStateBadge — all states">
          <SubSection label="Without drift">
            <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
              {DOC_STATES.map((state) => (
                <div key={state} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem' }}>
                  <DocStateBadge docState={state} />
                  <span style={{ fontSize: '0.7rem', color: '#999', fontFamily: 'monospace' }}>{state}</span>
                </div>
              ))}
            </div>
          </SubSection>
          <SubSection label="With drift (modified + liveOnly only)">
            <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem' }}>
                <DocStateBadge docState="modified" hasDrift={true} />
                <span style={{ fontSize: '0.7rem', color: '#999', fontFamily: 'monospace' }}>modified + drift</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem' }}>
                <DocStateBadge docState="liveOnly" hasDrift={true} />
                <span style={{ fontSize: '0.7rem', color: '#999', fontFamily: 'monospace' }}>liveOnly + drift</span>
              </div>
            </div>
          </SubSection>
        </Section>

        <Section title="PublishControl — all state/context combinations">
          <SubSection label="Branch context">
            <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                <PublishControl docState="modified" context="branch" onPublish={log('Publish to live')} />
                <span style={{ fontSize: '0.7rem', color: '#999', fontFamily: 'monospace' }}>modified (no drift)</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                <PublishControl docState="modified" hasDrift={true} context="branch" onReviewAndPublish={log('Review & publish')} />
                <span style={{ fontSize: '0.7rem', color: '#999', fontFamily: 'monospace' }}>modified + drift</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                <PublishControl docState="live" context="branch" />
                <span style={{ fontSize: '0.7rem', color: '#999', fontFamily: 'monospace' }}>live (badge only)</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                <PublishControl docState="liveOnly" context="branch" />
                <span style={{ fontSize: '0.7rem', color: '#999', fontFamily: 'monospace' }}>liveOnly (badge only)</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                <PublishControl docState="liveOnly" hasDrift={true} context="branch" />
                <span style={{ fontSize: '0.7rem', color: '#999', fontFamily: 'monospace' }}>liveOnly + drift</span>
              </div>
            </div>
          </SubSection>
          <SubSection label="Main context">
            <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                <PublishControl docState="unpublished" context="main" onPublish={log('Publish')} onCreateWorkstream={log('Create workstream')} />
                <span style={{ fontSize: '0.7rem', color: '#999', fontFamily: 'monospace' }}>unpublished</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                <PublishControl docState="live" context="main" />
                <span style={{ fontSize: '0.7rem', color: '#999', fontFamily: 'monospace' }}>live (badge only)</span>
              </div>
            </div>
          </SubSection>
        </Section>

        <Section title="AgentChip">
          <SubSection label="With progress + workstream badge">
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              {AGENT_CHIPS.map((agent) => (
                <AgentChip
                  key={agent.id}
                  agent={agent}
                  onStop={(id) => console.log('Stop:', id)}
                  currentWorkstream="main"
                />
              ))}
            </div>
          </SubSection>
          <SubSection label="Same workstream (no badge)">
            <AgentChip
              agent={AGENT_CHIPS[1]}
              onStop={noop}
              currentWorkstream="main"
            />
          </SubSection>
        </Section>

        <Section title="PresenceStack">
          <SubSection label="3 actors (default max)">
            <PresenceStack actors={PRESENCE_ACTORS.slice(0, 3)} />
          </SubSection>
          <SubSection label="5 actors (overflow +2)">
            <PresenceStack actors={PRESENCE_ACTORS} maxVisible={3} />
          </SubSection>
          <SubSection label="1 actor">
            <PresenceStack actors={PRESENCE_ACTORS.slice(0, 1)} />
          </SubSection>
          <SubSection label="Empty">
            <PresenceStack actors={[]} />
          </SubSection>
          <SubSection label="With live dots (header variant)">
            <PresenceStack actors={PRESENCE_ACTORS.slice(0, 3)} showActiveDot />
          </SubSection>
          <SubSection label="With live dots + overflow">
            <PresenceStack actors={PRESENCE_ACTORS} maxVisible={3} showActiveDot />
          </SubSection>
        </Section>

        <Section title="WorkstreamSwitcher">
          <SubSection label="On feature branch (with Compare button)">
            <WorkstreamSwitcher
              branches={BRANCHES}
              currentBranch={BRANCHES[1]}
              onSwitch={(id) => console.log('Switch to:', id)}
              onCompareWithLive={log('Compare with Live')}
            />
          </SubSection>
          <SubSection label="On main branch (no Compare button)">
            <WorkstreamSwitcher
              branches={BRANCHES}
              currentBranch={BRANCHES[0]}
              onSwitch={(id) => console.log('Switch to:', id)}
              onCompareWithLive={noop}
            />
          </SubSection>
        </Section>

        <Section title="PageNavigator (inline, no portal)">
          <div style={{ position: 'relative', border: '1px solid var(--pds-color-border-default, #e0e0e0)', borderRadius: 8, padding: '1rem' }}>
            <button
              type="button"
              onClick={() => setPageNavOpen(!pageNavOpen)}
              style={{ marginBottom: '0.5rem', cursor: 'pointer', padding: '0.5rem 1rem', border: '1px solid #ccc', borderRadius: 4, background: '#fff' }}
            >
              {pageNavOpen ? 'Close' : 'Open'} Page Navigator
            </button>
            <PageNavigator
              open={pageNavOpen}
              documents={DOCUMENTS}
              currentDocument={currentDoc}
              onSelect={(doc) => { setCurrentDoc(doc); setPageNavOpen(false); }}
              onClose={() => setPageNavOpen(false)}
            />
          </div>
        </Section>
      </div>
    </div>
  );
}
