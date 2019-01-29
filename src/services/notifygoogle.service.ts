import fetch from 'node-fetch';

import { googleProjectApiKey, serviceAccountIssuer, serviceAccountPrivateKey } from '../config';
import { Inject } from '../ioc';
import { StateChanges } from '../models';
import { delay } from '../util';
import { JwtService } from './jwt.service';
import { User, UserRepository } from './user.repository';

interface GoogleToken {
    token: string;
    expires: number;
}

export class NotifyGoogleService {
    private static token: Promise<GoogleToken>;

    constructor(
        @Inject('uid')
        private uid: string,
        private jwtService: JwtService,
        private userRepo: UserRepository,
    ) {
    }

    async requestSync() {
        if (!await this.userRepo.isUserLinked(this.uid)) { return; }

        while (true) {
            const response = await fetch(`https://homegraph.googleapis.com/v1/devices:requestSync?key=${googleProjectApiKey}`, {
                method: 'post',
                body: JSON.stringify({ agentUserId: this.uid }),
                headers: { 'content-type': 'application/json' },
            });
            if (response.ok) { return; }
            if (response.status === 429) {
                await delay((Math.floor(Math.random() * 20) + 5) * 1000);
                continue;
            }

            throw new Error(`while requestSync (${this.uid}). status: ${response.status} - ${await response.text()}`);
        }
    }

    async reportState(stateChanges: StateChanges, requestId?: string) {
        if (!await this.userRepo.isUserLinked(this.uid)) { return null; }
        const start = new Date().getTime();
        while (true) {
            const response = await this.reportStateInternal(stateChanges, requestId);
            if (response.ok) { return; }
            if (response.status !== 404 || new Date().getTime() - start > 60000) {
                throw new Error(`while reportState (${this.uid}). status: ${response.status} - ${await response.text()}`);
            }
            await delay(20000);
        }
    }

    private async reportStateInternal(stateChanges: StateChanges, requestId?: string) {
        if (!NotifyGoogleService.token ||
            (await NotifyGoogleService.token).expires < new Date().getTime()) {
            NotifyGoogleService.token = this.getToken().catch(err => {
                delete NotifyGoogleService.token;
                throw err;
            });
        }

        const token = await NotifyGoogleService.token;
        const body = {
            requestId,
            agentUserId: this.uid,
            payload: {
                devices: {
                    states: stateChanges
                }
            }
        };

        const response = await fetch(`https://homegraph.googleapis.com/v1/devices:reportStateAndNotification`, {
            method: 'post',
            body: JSON.stringify(body),
            headers: {
                'content-type': 'application/json',
                'authorization': `Bearer ${token.token}`,
                'X-GFE-SSL': 'yes',
            },
        });

        return response;
    }

    private async getToken() {
        const now = Math.round(new Date().getTime() / 1000);
        const jwt = {
            'iss': serviceAccountIssuer,
            'scope': 'https://www.googleapis.com/auth/homegraph',
            'aud': 'https://accounts.google.com/o/oauth2/token',
            'iat': now,
            'exp': now + 3600,
        };
        const token = await this.jwtService.sign(jwt, serviceAccountPrivateKey, { algorithm: 'RS256' });

        const response = await fetch('https://accounts.google.com/o/oauth2/token', {
            method: 'post',
            body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${encodeURIComponent(token)}`,
            headers: {
                'content-type': 'application/x-www-form-urlencoded',
                'assertion': token,
                'authorization': `Bearer ${token}`,
            },
        });
        if (!response.ok) {
            throw new Error(`whilte getToken status: ${response.status} - ${await response.text()}`);
        }

        const result: { access_token: string, expires_in: number } = await response.json();
        return {
            token: result.access_token,
            expires: new Date().getTime() + result.expires_in * 1000 - 5000
        } as GoogleToken;
    }
}
