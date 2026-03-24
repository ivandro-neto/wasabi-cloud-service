import axios, { AxiosInstance } from 'axios';
import { config } from '../config/config';
import { logger } from '../logger';

interface AuthResponse {
    data: {
        accessToken: string;
        refreshToken: string;
        user?: any;
    };
}

interface AudioNotification {
    filename: string;
    source: string;
    agentName: string;
    customerPhone: string;
    duration: number;
    wasabiUrl: string;
    fileSize: number;
    status: string;
}

export class ExternalApiService {
    private client: AxiosInstance;
    private accessToken: string | null = null;
    private refreshToken: string | null = null;
    private isRefreshing = false;
    private refreshSubscribers: ((token: string) => void)[] = [];

    constructor() {
        this.client = axios.create({
            baseURL: config.externalApi.baseUrl,
            headers: {
                'Content-Type': 'application/json',
                'accept': '*/*',
            },
        });

        this.setupInterceptors();
    }

    private setupInterceptors() {
        this.client.interceptors.request.use(
            (config) => {
                if (this.accessToken) {
                    config.headers['Authorization'] = `Bearer ${this.accessToken}`;
                }
                return config;
            },
            (error) => Promise.reject(error)
        );

        this.client.interceptors.response.use(
            (response) => response,
            async (error) => {
                const originalRequest = error.config;

                if (error.response?.status === 401 && !originalRequest._retry) {
                    if (this.isRefreshing) {
                        return new Promise((resolve) => {
                            this.subscribeTokenRefresh((token) => {
                                originalRequest.headers['Authorization'] = `Bearer ${token}`;
                                resolve(this.client(originalRequest));
                            });
                        });
                    }

                    originalRequest._retry = true;
                    this.isRefreshing = true;

                    try {
                        const newToken = await this.refreshTokens();
                        this.onTokenRefreshed(newToken);
                        originalRequest.headers['Authorization'] = `Bearer ${newToken}`;
                        return this.client(originalRequest);
                    } catch (refreshError) {
                        logger.error('Failed to refresh token, logging in again...');
                        try {
                            const newToken = await this.login();
                            this.onTokenRefreshed(newToken);
                            originalRequest.headers['Authorization'] = `Bearer ${newToken}`;
                            return this.client(originalRequest);
                        } catch (loginError) {
                            return Promise.reject(loginError);
                        }
                    } finally {
                        this.isRefreshing = false;
                    }
                }

                return Promise.reject(error);
            }
        );
    }

    private subscribeTokenRefresh(cb: (token: string) => void) {
        this.refreshSubscribers.push(cb);
    }

    private onTokenRefreshed(token: string) {
        this.refreshSubscribers.map((cb) => cb(token));
        this.refreshSubscribers = [];
    }

    async login(): Promise<string> {
        try {
            logger.info('External API: Logging in...');
            const response = await axios.post<AuthResponse>(
                `${config.externalApi.baseUrl}${config.externalApi.authLoginPath}`,
                {
                    email: config.externalApi.email,
                    password: config.externalApi.password,
                }
            );

            this.accessToken = response.data.data.accessToken;
            this.refreshToken = response.data.data.refreshToken;
            logger.info('External API: Login successful');
            return this.accessToken;
        } catch (error: any) {
            logger.error(`External API Login failed: ${error.message}`);
            throw error;
        }
    }

    async refreshTokens(): Promise<string> {
        if (!this.refreshToken) {
            throw new Error('No refresh token available');
        }

        try {
            logger.info('External API: Refreshing token...');
            const response = await axios.post<AuthResponse>(
                `${config.externalApi.baseUrl}${config.externalApi.authRefreshPath}`,
                {
                    refreshToken: this.refreshToken,
                }
            );

            this.accessToken = response.data.data.accessToken;
            this.refreshToken = response.data.data.refreshToken;
            logger.info('External API: Token refresh successful');
            return this.accessToken;
        } catch (error: any) {
            logger.error(`External API Token refresh failed: ${error.message}`);
            throw error;
        }
    }

    async notifyAudio(data: AudioNotification): Promise<void> {
        try {
            if (!this.accessToken) {
                await this.login();
            }

            await this.client.post(config.externalApi.audiosPath, data);
            logger.info(`External API: Notified audio registration for ${data.filename}`);
        } catch (error: any) {
            logger.error(`External API Notification failed for ${data.filename}: ${error.message}`);
            throw error;
        }
    }
}

export const externalApiService = new ExternalApiService();
