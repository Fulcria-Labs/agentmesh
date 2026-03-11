/**
 * AgentMesh Dashboard - Lightweight web UI for monitoring the mesh
 *
 * Zero external dependencies - uses Node.js built-in http module.
 * Shows real-time agent status, task progress, and mesh metrics.
 */

import * as http from 'http';
import { MeshNode } from '../core/mesh-node';
import { AgentRegistry } from '../core/agent-registry';
import { TaskCoordinator } from '../core/task-coordinator';

export interface DashboardOptions {
  port?: number;
  host?: string;
  meshNode?: MeshNode;
  registry?: AgentRegistry;
  coordinator?: TaskCoordinator;
}

export class Dashboard {
  private server: http.Server | null = null;
  private port: number;
  private host: string;
  private meshNode: MeshNode | null;
  private registry: AgentRegistry | null;
  private coordinator: TaskCoordinator | null;

  constructor(options: DashboardOptions = {}) {
    this.port = options.port || 3456;
    this.host = options.host || 'localhost';
    this.meshNode = options.meshNode || null;
    this.registry = options.registry || options.meshNode?.getRegistry() || null;
    this.coordinator = options.coordinator || options.meshNode?.getCoordinator() || null;
  }

  async start(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.on('error', reject);
      this.server.listen(this.port, this.host, () => {
        const url = `http://${this.host}:${this.port}`;
        resolve(url);
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = req.url || '/';

    if (url === '/api/status') {
      this.handleApiStatus(res);
    } else if (url === '/api/agents') {
      this.handleApiAgents(res);
    } else if (url === '/api/tasks') {
      this.handleApiTasks(res);
    } else {
      this.handleDashboardPage(res);
    }
  }

  private handleApiStatus(res: http.ServerResponse): void {
    const profile = this.meshNode?.getProfile();
    const data = {
      node: profile ? {
        id: profile.id,
        name: profile.name,
        status: profile.status,
        account: profile.hederaAccountId,
        capabilities: profile.capabilities.map(c => c.name),
      } : null,
      agents: this.registry?.getAgentCount() || 0,
      tasks: this.coordinator?.getTaskCount() || 0,
      uptime: process.uptime(),
    };

    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(data));
  }

  private handleApiAgents(res: http.ServerResponse): void {
    const agents = this.registry?.getAllAgents() || [];
    const data = agents.map(a => ({
      id: a.id,
      name: a.name,
      description: a.description,
      status: a.status,
      capabilities: a.capabilities.map(c => c.name),
      account: a.hederaAccountId,
    }));

    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(data));
  }

  private handleApiTasks(res: http.ServerResponse): void {
    const tasks = this.coordinator?.getAllTasks() || [];
    const data = tasks.map(t => ({
      id: t.id,
      description: t.description,
      priority: t.priority,
      capabilities: t.requiredCapabilities,
      bids: this.coordinator?.getTaskBids(t.id).length || 0,
      assignments: this.coordinator?.getTaskAssignments(t.id).length || 0,
    }));

    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(data));
  }

  private handleDashboardPage(res: http.ServerResponse): void {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(DASHBOARD_HTML);
  }

  getPort(): number {
    return this.port;
  }
}

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AgentMesh Dashboard</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0e17; color: #e0e0e0; }
  .header { background: linear-gradient(135deg, #1a1f35, #0d1225); padding: 20px 30px; border-bottom: 1px solid #2a2f45; display: flex; align-items: center; gap: 15px; }
  .header h1 { font-size: 24px; color: #8b5cf6; }
  .header .subtitle { color: #888; font-size: 14px; }
  .header .status { margin-left: auto; display: flex; align-items: center; gap: 8px; }
  .dot { width: 10px; height: 10px; border-radius: 50%; background: #22c55e; animation: pulse 2s infinite; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; padding: 20px 30px; }
  .card { background: #141929; border: 1px solid #2a2f45; border-radius: 12px; padding: 20px; }
  .card h2 { font-size: 14px; text-transform: uppercase; color: #888; margin-bottom: 12px; letter-spacing: 1px; }
  .metric { font-size: 36px; font-weight: 700; color: #8b5cf6; }
  .metric-label { font-size: 13px; color: #666; margin-top: 4px; }
  .section { padding: 0 30px 20px; }
  .section h2 { font-size: 18px; margin-bottom: 15px; color: #ccc; }
  table { width: 100%; border-collapse: collapse; background: #141929; border-radius: 12px; overflow: hidden; }
  th { text-align: left; padding: 12px 16px; background: #1a1f35; color: #888; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; }
  td { padding: 12px 16px; border-top: 1px solid #1f2438; font-size: 14px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
  .badge-active { background: #22c55e22; color: #22c55e; }
  .badge-busy { background: #f59e0b22; color: #f59e0b; }
  .badge-inactive { background: #ef444422; color: #ef4444; }
  .badge-cap { background: #8b5cf622; color: #8b5cf6; margin: 2px; }
  .badge-high { background: #ef444422; color: #ef4444; }
  .badge-medium { background: #f59e0b22; color: #f59e0b; }
  .badge-low { background: #22c55e22; color: #22c55e; }
  .badge-critical { background: #dc262622; color: #dc2626; }
  .empty { text-align: center; padding: 40px; color: #555; }
  .hedera-logo { font-size: 14px; color: #666; }
  .refresh-note { font-size: 12px; color: #555; margin-top: 20px; text-align: center; padding-bottom: 20px; }
</style>
</head>
<body>
<div class="header">
  <h1>&#9670; AgentMesh</h1>
  <span class="subtitle">Decentralized AI Agent Coordination on Hedera</span>
  <div class="status"><div class="dot"></div><span id="status-text">Connecting...</span></div>
</div>
<div class="grid">
  <div class="card"><h2>Agents Online</h2><div class="metric" id="agent-count">-</div><div class="metric-label">registered in mesh</div></div>
  <div class="card"><h2>Active Tasks</h2><div class="metric" id="task-count">-</div><div class="metric-label">in coordination</div></div>
  <div class="card"><h2>Node Status</h2><div class="metric" id="node-name" style="font-size:24px">-</div><div class="metric-label" id="node-account">-</div></div>
  <div class="card"><h2>Uptime</h2><div class="metric" id="uptime">-</div><div class="metric-label">seconds</div></div>
</div>
<div class="section">
  <h2>Agents</h2>
  <table><thead><tr><th>Name</th><th>Status</th><th>Capabilities</th><th>Account</th></tr></thead><tbody id="agents-body"><tr><td colspan="4" class="empty">Loading...</td></tr></tbody></table>
</div>
<div class="section" style="margin-top:20px">
  <h2>Tasks</h2>
  <table><thead><tr><th>Description</th><th>Priority</th><th>Required</th><th>Bids</th><th>Assigned</th></tr></thead><tbody id="tasks-body"><tr><td colspan="5" class="empty">Loading...</td></tr></tbody></table>
</div>
<div class="refresh-note">Auto-refreshes every 3 seconds &middot; Powered by Hedera Consensus Service</div>
<script>
async function refresh() {
  try {
    const [status, agents, tasks] = await Promise.all([
      fetch('/api/status').then(r => r.json()),
      fetch('/api/agents').then(r => r.json()),
      fetch('/api/tasks').then(r => r.json()),
    ]);
    document.getElementById('status-text').textContent = status.node ? 'Connected' : 'No Node';
    document.getElementById('agent-count').textContent = status.agents;
    document.getElementById('task-count').textContent = status.tasks;
    document.getElementById('node-name').textContent = status.node?.name || 'Not started';
    document.getElementById('node-account').textContent = status.node?.account || '';
    document.getElementById('uptime').textContent = Math.floor(status.uptime);
    const ab = document.getElementById('agents-body');
    if (agents.length === 0) {
      ab.innerHTML = '<tr><td colspan="4" class="empty">No agents registered</td></tr>';
    } else {
      ab.innerHTML = agents.map(a =>
        '<tr><td><strong>' + a.name + '</strong><br><small style="color:#666">' + (a.description||'').substring(0,60) + '</small></td>'
        + '<td><span class="badge badge-' + a.status + '">' + a.status + '</span></td>'
        + '<td>' + a.capabilities.map(c => '<span class="badge badge-cap">' + c + '</span>').join('') + '</td>'
        + '<td style="font-family:monospace;font-size:12px">' + a.account + '</td></tr>'
      ).join('');
    }
    const tb = document.getElementById('tasks-body');
    if (tasks.length === 0) {
      tb.innerHTML = '<tr><td colspan="5" class="empty">No active tasks</td></tr>';
    } else {
      tb.innerHTML = tasks.map(t =>
        '<tr><td>' + t.description.substring(0,80) + '</td>'
        + '<td><span class="badge badge-' + t.priority + '">' + t.priority + '</span></td>'
        + '<td>' + t.capabilities.map(c => '<span class="badge badge-cap">' + c + '</span>').join('') + '</td>'
        + '<td>' + t.bids + '</td><td>' + t.assignments + '</td></tr>'
      ).join('');
    }
  } catch(e) { document.getElementById('status-text').textContent = 'Error'; }
}
refresh();
setInterval(refresh, 3000);
</script>
</body>
</html>`;
