import { KpiBand, MetricCard } from '@/components/ds';
import { Server, Boxes, Globe, Users } from 'lucide-react';

const WorkspaceOverviewTab = ({ ws, since, members, srvIn, services, sites }) => (
    <div className="ws-detail__grid">
        <section className="ws-detail__card">
            <h3>Workspace</h3>
            <div className="sk-info-row"><span className="k">Slug</span><span className="v">/{ws.slug}</span></div>
            <div className="sk-info-row"><span className="k">Created</span><span className="v">{since || '—'}</span></div>
            <div className="sk-info-row"><span className="k">Max servers</span><span className="v">{ws.max_servers > 0 ? ws.max_servers : 'Unlimited'}</span></div>
            <div className="sk-info-row"><span className="k">Max users</span><span className="v">{ws.max_users > 0 ? ws.max_users : 'Unlimited'}</span></div>
        </section>
        <section className="ws-detail__card">
            <h3>Resources</h3>
            <KpiBand>
                <MetricCard icon={<Server size={16} />} tone="accent" value={srvIn.length} label="Servers" />
                <MetricCard icon={<Boxes size={16} />} tone="accent" value={services.length} label="Services" />
                <MetricCard icon={<Globe size={16} />} tone="accent" value={sites.length} label="Sites" />
                <MetricCard icon={<Users size={16} />} tone="accent" value={members.length} label="Members" />
            </KpiBand>
        </section>
    </div>
);

export default WorkspaceOverviewTab;
