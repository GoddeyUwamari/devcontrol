import { Server as HTTPServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { authService } from '../services/auth.service';
import { getCurrentMembership, OrganizationRole } from '../services/organization-authorization';
import { membershipClaimsSchema } from '../middleware/auth.middleware';
import { pool } from '../config/database';

/** Who a socket belongs to -- set at handshake from current membership. */
interface SocketIdentity {
  userId: string;
  organizationId: string;
  email: string;
  role: OrganizationRole;
  /** When the access token the socket was opened with expires (ms epoch). */
  expiresAt: number;
}

// setTimeout's maximum delay; access tokens expire well within it.
const MAX_TIMER_MS = 2 ** 31 - 1;

export class WebSocketServer {
  private io: SocketIOServer;

  constructor(httpServer: HTTPServer) {
    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: process.env.FRONTEND_URL || 'http://localhost:3010',
        credentials: true,
      },
      // Use namespaces for organization isolation
      path: '/socket.io',
    });

    this.setupMiddleware();
    this.setupEventHandlers();
  }

  private setupMiddleware() {
    // Handshake: an access token whose user is a current, active member of
    // its organization. Same rules as HTTP authenticate; the role is the
    // membership's, never the token's claim.
    this.io.use(async (socket: Socket, next) => {
      try {
        const token = socket.handshake.auth?.token;

        if (!token) {
          return next(new Error('Authentication token required'));
        }

        const decoded = authService.verifyToken(token) as ReturnType<typeof authService.verifyToken> & { exp?: number };
        const claims = membershipClaimsSchema.safeParse(decoded);
        if (decoded.type !== 'access' || !claims.success || typeof decoded.exp !== 'number') {
          return next(new Error('Authentication failed'));
        }

        const { userId, organizationId } = claims.data;
        const membership = await getCurrentMembership(pool, organizationId, userId);
        if (!membership) {
          return next(new Error('Authentication failed'));
        }

        const identity: SocketIdentity = {
          userId,
          organizationId,
          email: membership.email,
          role: membership.role,
          expiresAt: decoded.exp * 1000,
        };
        socket.data = identity;

        next();
      } catch (error) {
        next(new Error('Authentication failed'));
      }
    });
  }

  private setupEventHandlers() {
    this.io.on('connection', (socket: Socket) => {
      const identity = socket.data as SocketIdentity;
      console.log(`✅ WebSocket connected: ${identity.email} (${identity.organizationId})`);

      // Join organization-specific room for data isolation
      const orgRoom = `org:${identity.organizationId}`;
      socket.join(orgRoom);

      // A socket never outlives the access token it was opened with.
      const expiry = setTimeout(
        () => socket.disconnect(true),
        Math.min(Math.max(identity.expiresAt - Date.now(), 0), MAX_TIMER_MS)
      );

      // Handle disconnection
      socket.on('disconnect', (reason) => {
        clearTimeout(expiry);
        console.log(`❌ WebSocket disconnected: ${identity.email} - ${reason}`);
      });

      // Handle errors
      socket.on('error', (error) => {
        console.error('WebSocket error:', error);
      });

      // Heartbeat for connection monitoring
      socket.on('ping', () => {
        socket.emit('pong');
      });
    });
  }

  /** This process's sockets belonging to `userId` in `organizationId`. */
  private socketsOf(userId: string, organizationId: string): Socket[] {
    return [...this.io.of('/').sockets.values()].filter((socket) => {
      const identity = socket.data as Partial<SocketIdentity>;
      return identity.userId === userId && identity.organizationId === organizationId;
    });
  }

  /**
   * Closes a user's open sockets in one organization, e.g. once their
   * membership is removed. Only sockets connected to this process are
   * reached.
   */
  public disconnectUserFromOrganization(userId: string, organizationId: string): void {
    for (const socket of this.socketsOf(userId, organizationId)) {
      socket.disconnect(true);
    }
  }

  /** Keeps open sockets' role in step with a membership role change. */
  public updateUserRoleInOrganization(userId: string, organizationId: string, role: OrganizationRole): void {
    for (const socket of this.socketsOf(userId, organizationId)) {
      (socket.data as SocketIdentity).role = role;
    }
  }

  // Broadcast to specific organization
  public emitToOrganization(organizationId: string, event: string, data: any) {
    this.io.to(`org:${organizationId}`).emit(event, data);
  }

  // Broadcast to all clients
  public broadcast(event: string, data: any) {
    this.io.emit(event, data);
  }

  // Get connected clients count for organization
  public getOrgConnections(organizationId: string): number {
    const orgRoom = `org:${organizationId}`;
    return this.io.sockets.adapter.rooms.get(orgRoom)?.size || 0;
  }
}
