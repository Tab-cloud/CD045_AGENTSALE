import { Console } from '../../components/console';
import { AccessGate } from '../../components/access-gate';
export default async function Page({ params }: { params: Promise<{ section?: string[] }> }) {
  const { section = [] } = await params;
  return <AccessGate><Console route={section} /></AccessGate>;
}
