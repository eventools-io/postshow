import { Section } from '@/components/page';

const REPOSITORY_URL = 'https://github.com/eventools-io/postshow';
const RELEASES_URL = `${REPOSITORY_URL}/releases`;
const DESKTOP_SOURCE_URL = `${REPOSITORY_URL}/tree/main/apps/postshow-desktop`;

/** No tagged release exists yet, so nothing is downloadable. The signing and
 * notarization pipeline is real, which is why this points at the releases page
 * rather than promising a date. */
export function DesktopAgentSection() {
  return (
    <Section title="Desktop agent">
      <div className="ps-card flex flex-col gap-3 p-5">
        <p className="m-0 font-public-mono text-[10px] uppercase tracking-[0.12em] text-warn">
          no build published yet
        </p>
        <p className="m-0 max-w-[62ch] font-public-sans text-[13px] leading-[1.55] text-night-fg-2">
          The desktop agent keeps this workspace in a menu-bar app and runs your local jobs on a
          schedule, catching up after the machine sleeps. It reads the profile{' '}
          <code className="font-public-mono text-[12px] text-night-fg">postshow init</code> writes,
          so setup still happens once in a terminal; after that the agent runs without one.
        </p>
        <p className="m-0 max-w-[62ch] font-public-sans text-[13px] leading-[1.55] text-night-fg-2">
          Signed and notarized macOS and Windows installers are built by the release pipeline and
          land on the releases page. No version has been tagged, so there is nothing to download
          today.
        </p>
        <div className="flex flex-wrap gap-2">
          <a href={RELEASES_URL} className="ps-btn-ghost" target="_blank" rel="noreferrer">
            Watch for the first release
          </a>
          <a href={DESKTOP_SOURCE_URL} className="ps-btn-ghost" target="_blank" rel="noreferrer">
            Build it from source
          </a>
        </div>
      </div>
    </Section>
  );
}
