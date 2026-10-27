// Lab-side state that is not FortiGate config: who is logged in, cables, ISP conditions, VPN clients.
// The store keeps it in runtime.lab and pushes it here so engine functions can read it.

export interface AuthUser {
  ip: string;
  host: string;
  user: string;
  groups: string[];
  method: 'local' | 'ldap' | 'radius';
  server?: string;
  time: number;
  expires: number;
}

export interface SslClient {
  host: string;
  user: string;
  groups: string[];
  ip: string;
  portal: string;
  time: number;
}

export interface LabState {
  auth: Record<string, AuthUser>; // keyed by source IP, like the FortiGate auth table
  sslClients: Record<string, SslClient>; // keyed by lab host id
  vpnDown: Record<string, boolean>; // tunnels brought down by the admin
  wan2Cable: boolean; // is wan2 plugged into ISP2?
  ispDown: Record<string, boolean>; // ISP upstream outage (link stays up!)
  ispLatency: Record<string, number>; // ms
  ispLoss: Record<string, number>; // %
}

export const defaultLab = (): LabState => ({ auth: {}, sslClients: {}, vpnDown: {}, wan2Cable: false, ispDown: {}, ispLatency: { wan1: 4, wan2: 9 }, ispLoss: { wan1: 0, wan2: 0 } });

let current: LabState = defaultLab();
export const getLab = () => current;
export const setLab = (l: LabState) => {
  current = l;
};
