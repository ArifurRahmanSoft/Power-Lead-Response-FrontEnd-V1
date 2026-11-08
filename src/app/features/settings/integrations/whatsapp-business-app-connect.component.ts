import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  DestroyRef,
  OnDestroy,
  OnInit,
  PLATFORM_ID,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { TimeoutError, finalize, timeout } from 'rxjs';

import { PERMISSIONS } from '../../../core/models/auth.models';
import { AuthService } from '../../../core/services/auth.service';
import {
  MetaWhatsAppConnectInitiation,
  MetaWhatsAppConnectOperationData,
  MetaWhatsAppConnectReadiness,
  MetaWhatsAppEmbeddedSignupSession,
} from '../../whatsapp/models/meta-whatsapp.models';
import {
  FacebookLoginResponse,
  FacebookSdkService,
} from '../../whatsapp/services/facebook-sdk.service';
import { MetaWhatsAppService } from '../../whatsapp/services/meta-whatsapp.service';
import { leadErrorDetails } from '../../leads/services/lead-errors';

type FlowPhase =
  | 'idle'
  | 'preparing'
  | 'prepared'
  | 'launching'
  | 'submitting'
  | 'recovering'
  | 'confirmation'
  | 'activating'
  | 'success';

type OperationOutcome = 'confirmation' | 'success' | 'pending' | 'failure' | 'schema_missing';

interface EmbeddedSignupMessage {
  type: 'WA_EMBEDDED_SIGNUP';
  event: string;
  data: Record<string, unknown>;
}

interface OnboardingDiagnostics {
  stage:
    | 'idle'
    | 'prepared'
    | 'waiting_for_code_and_session'
    | 'waiting_for_code'
    | 'waiting_for_session'
    | 'submitting_completion'
    | 'recovering_operation'
    | 'confirmation_required'
    | 'activating_sender'
    | 'completed'
    | 'failed';
  code_received: boolean;
  session_received: boolean;
  connect_complete_reached: boolean;
  status_checks: number;
  error_code: string | null;
}

const ALLOWED_META_MESSAGE_ORIGINS = new Set([
  'https://www.facebook.com',
  'https://web.facebook.com',
  'https://business.facebook.com',
]);
const MAX_RECOVERY_ATTEMPTS = 3;
const RECOVERY_DELAY_MS = 750;
const HANDSHAKE_TIMEOUT_MS = 30_000;
const API_RESPONSE_TIMEOUT_MS = 15_000;
const SUCCESS_STATUSES = new Set([
  'completed',
  'complete',
  'succeeded',
  'active',
  'activated',
  'connected',
]);
const PENDING_STATUSES = new Set(['pending', 'processing', 'in_progress']);
const FAILURE_STATUSES = new Set(['failed', 'error', 'expired', 'cancelled', 'canceled']);

@Component({
  selector: 'app-whatsapp-business-app-connect',
  imports: [RouterLink],
  templateUrl: './whatsapp-business-app-connect.component.html',
  styleUrls: ['../settings.shared.css', './whatsapp-business-app-connect.component.css'],
})
export class WhatsAppBusinessAppConnectComponent implements OnInit, OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly meta = inject(MetaWhatsAppService);
  private readonly facebook = inject(FacebookSdkService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  protected readonly canUpdate = computed(() =>
    this.auth.hasPermission(PERMISSIONS.settingsIntegrationsUpdate),
  );
  protected readonly readinessLoading = signal(true);
  protected readonly configurationReady = signal(false);
  protected readonly readinessIssues = signal<readonly string[]>([]);
  protected readonly readinessError = signal('');
  protected readonly phase = signal<FlowPhase>('idle');
  protected readonly flowError = signal('');
  protected readonly flowWarning = signal('');
  protected readonly channelSender = signal('');
  protected readonly confirmationDetails = signal('');
  protected readonly diagnostics = signal<OnboardingDiagnostics>({
    stage: 'idle',
    code_received: false,
    session_received: false,
    connect_complete_reached: false,
    status_checks: 0,
    error_code: null,
  });

  private operation: MetaWhatsAppConnectInitiation | null = null;
  private authorizationCode: string | null = null;
  private signupSession: MetaWhatsAppEmbeddedSignupSession | null = null;
  private sessionMessageSource: MessageEventSource | null = null;
  private completionStarted = false;
  private listenerInstalled = false;
  private destroyed = false;
  private recoveryAttempts = 0;
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;
  private recoveryTimer: ReturnType<typeof setTimeout> | null = null;
  private handshakeTimer: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    this.loadReadiness();
    this.refreshChannel();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.clearFlowResources();
    this.clearSensitiveFlowState();
  }

  protected prepareConnection(): void {
    if (!this.canUpdate() || !this.configurationReady() || this.phase() !== 'idle') return;
    this.flowError.set('');
    this.flowWarning.set('');
    this.phase.set('preparing');
    this.meta
      .initiateConnection()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ data }) => {
          const validationError = this.validateInitiation(data);
          if (validationError) {
            this.failFlow(validationError);
            return;
          }
          this.operation = data;
          this.scheduleExpiry(data.expires_at);
          this.facebook
            .load(data.app_id, data.graph_api_version)
            .then(() => {
              if (this.destroyed || this.operation !== data) return;
              if (this.operationExpired()) {
                this.expireFlow();
                return;
              }
              this.phase.set('prepared');
              this.patchDiagnostics({ stage: 'prepared' });
            })
            .catch((error: unknown) => {
              if (!this.destroyed && this.operation === data)
                this.failFlow(this.errorMessage(error, 'Facebook SDK could not be prepared.'));
            });
        },
        error: (error: unknown) =>
          this.failFlow(this.errorMessage(error, 'Unable to prepare WhatsApp onboarding.')),
      });
  }

  protected launchFacebookSignup(): void {
    const operation = this.operation;
    if (this.phase() !== 'prepared' || !operation || this.operationExpired()) {
      if (operation && this.operationExpired()) this.expireFlow();
      return;
    }

    this.flowError.set('');
    this.flowWarning.set('');
    this.authorizationCode = null;
    this.signupSession = null;
    this.sessionMessageSource = null;
    this.completionStarted = false;
    this.phase.set('launching');
    this.installMessageListener();
    this.patchDiagnostics({
      stage: 'waiting_for_code_and_session',
      code_received: false,
      session_received: false,
      connect_complete_reached: false,
      status_checks: 0,
      error_code: null,
    });
    this.scheduleHandshakeTimeout();

    try {
      this.facebook.login(
        {
          config_id: operation.configuration_id,
          response_type: operation.response_type,
          override_default_response_type: operation.override_default_response_type,
          extras: operation.extras,
        },
        (response) => this.handleLoginResponse(response, operation.operation_id),
      );
    } catch (error) {
      this.failFlow(
        this.errorMessage(
          error,
          'Facebook signup could not open. Check popup permissions and try again.',
        ),
      );
    }
  }

  protected cancelPreparedFlow(): void {
    if (this.phase() === 'submitting' || this.phase() === 'activating') return;
    this.resetFlow();
  }

  protected confirmSenderReplacement(): void {
    const operationId = this.operation?.operation_id;
    if (this.phase() !== 'confirmation' || !operationId || !this.canUpdate()) return;
    this.phase.set('activating');
    this.patchDiagnostics({ stage: 'activating_sender', error_code: null });
    this.flowError.set('');
    this.meta
      .activateConnection(operationId)
      .pipe(timeout(API_RESPONSE_TIMEOUT_MS), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          if (this.operation?.operation_id !== operationId) return;
          if (response.success !== true) {
            this.failFlow(
              response.message?.trim() || 'WhatsApp sender activation was not successful.',
              'activation_response_unsuccessful',
            );
            return;
          }
          this.handleOperationData(response.data, 'activation');
        },
        error: (error: unknown) => {
          if (this.operation?.operation_id === operationId)
            this.handleUncertainMutation(error, 'activation');
        },
      });
  }

  protected declineSenderReplacement(): void {
    if (this.phase() !== 'confirmation') return;
    this.resetFlow();
    this.flowWarning.set(
      'The connection was not activated; the existing sender was left unchanged.',
    );
  }

  protected retryReadiness(): void {
    this.loadReadiness();
  }

  private loadReadiness(): void {
    this.readinessLoading.set(true);
    this.readinessError.set('');
    this.meta
      .getConnectReadiness()
      .pipe(
        finalize(() => this.readinessLoading.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (response) => {
          if (response.success !== true) {
            this.configurationReady.set(false);
            this.readinessIssues.set([
              response.message?.trim() || 'Backend readiness response did not return success=true.',
            ]);
            return;
          }
          const contractErrors = this.readinessContractErrors(response.data);
          if (contractErrors.length) {
            this.configurationReady.set(false);
            this.readinessIssues.set(contractErrors);
            return;
          }

          const data = response.data as MetaWhatsAppConnectReadiness;
          const blockingIssues = this.readinessBlockingIssues(data);
          const inconsistent = data.oauth_configuration_ready && blockingIssues.length > 0;
          this.configurationReady.set(data.oauth_configuration_ready && !inconsistent);
          if (inconsistent) {
            this.readinessIssues.set([
              'Backend readiness response is inconsistent: data.oauth_configuration_ready is true while setting blockers are present.',
              ...blockingIssues,
            ]);
          } else if (!data.oauth_configuration_ready) {
            this.readinessIssues.set(
              blockingIssues.length
                ? blockingIssues
                : [
                    'Backend reported data.oauth_configuration_ready=false without any names in data.missing_settings or data.invalid_settings.',
                  ],
            );
          } else {
            this.readinessIssues.set([]);
          }
        },
        error: (error: unknown) => {
          this.configurationReady.set(false);
          this.readinessIssues.set([]);
          this.readinessError.set(
            this.errorMessage(error, 'Unable to check WhatsApp onboarding configuration.'),
          );
        },
      });
  }

  private refreshChannel(): void {
    this.meta
      .getChannel()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ data }) => this.channelSender.set(data.active ? data.sender_address : ''),
        error: () => this.channelSender.set(''),
      });
  }

  private handleLoginResponse(response: FacebookLoginResponse, operationId: string): void {
    if (this.operation?.operation_id !== operationId || this.completionStarted) return;
    const code = response.authResponse?.code;
    if (typeof code !== 'string' || !code.trim()) {
      this.failFlow(
        response.status === 'not_authorized'
          ? 'Facebook authorization was not granted.'
          : 'Facebook signup was cancelled or closed before an authorization code was returned.',
        response.status === 'not_authorized'
          ? 'facebook_not_authorized'
          : 'authorization_cancelled',
      );
      return;
    }
    this.authorizationCode = code;
    this.patchDiagnostics({
      code_received: true,
      stage: this.signupSession ? 'submitting_completion' : 'waiting_for_session',
    });
    this.submitWhenReady();
  }

  private readonly handleWindowMessage = (event: MessageEvent<unknown>) => {
    if (!this.listenerInstalled || !ALLOWED_META_MESSAGE_ORIGINS.has(event.origin)) return;
    const message = this.parseEmbeddedSignupMessage(event.data);
    if (!message) return;
    if (this.sessionMessageSource && event.source !== this.sessionMessageSource) return;

    if (message.event === 'CANCEL') {
      this.failFlow('Facebook signup was cancelled before completion.', 'session_cancelled');
      return;
    }
    if (message.event === 'ERROR') {
      const detail =
        this.stringValue(message.data['error_message']) ??
        this.stringValue(message.data['message']);
      this.failFlow(
        detail ? `Facebook signup failed: ${detail}` : 'Facebook signup reported an error.',
        this.safeDiagnosticCode(message.data['error_code'] ?? 'session_error'),
      );
      return;
    }
    if (message.event !== 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING') {
      this.failFlow(
        `Unsupported WhatsApp signup completion event: ${message.event}. Expected FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING for Coexistence onboarding.`,
        'unsupported_session_event',
      );
      return;
    }

    const wabaId = this.stringValue(message.data['waba_id']);
    const phoneNumberId = this.stringValue(message.data['phone_number_id']);
    if (!wabaId || !phoneNumberId) {
      const missingFields = [
        ...(wabaId ? [] : ['data.waba_id']),
        ...(phoneNumberId ? [] : ['data.phone_number_id']),
      ];
      this.failFlow(
        `WhatsApp signup completed, but the session payload is missing ${missingFields.join(' and ')} required by /connect/complete. The completion request was not submitted.`,
        'session_missing_required_fields',
      );
      return;
    }
    const businessId = this.stringValue(message.data['business_id']);
    const session: MetaWhatsAppEmbeddedSignupSession = {
      event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
      waba_id: wabaId,
      phone_number_id: phoneNumberId,
      ...(businessId ? { business_id: businessId } : {}),
    };

    if (this.signupSession) {
      if (
        this.signupSession.waba_id !== session.waba_id ||
        this.signupSession.phone_number_id !== session.phone_number_id
      ) {
        this.failFlow('Conflicting WhatsApp signup session events were received. Start again.');
      }
      return;
    }
    this.sessionMessageSource = event.source;
    this.signupSession = session;
    this.patchDiagnostics({
      session_received: true,
      stage: this.authorizationCode ? 'submitting_completion' : 'waiting_for_code',
    });
    this.submitWhenReady();
  };

  private parseEmbeddedSignupMessage(value: unknown): EmbeddedSignupMessage | null {
    let parsed = value;
    if (typeof parsed === 'string') {
      try {
        parsed = JSON.parse(parsed) as unknown;
      } catch {
        return null;
      }
    }
    if (!this.isRecord(parsed) || parsed['type'] !== 'WA_EMBEDDED_SIGNUP') return null;
    if (typeof parsed['event'] !== 'string' || !this.isRecord(parsed['data'])) {
      this.failFlow(
        'Malformed WA_EMBEDDED_SIGNUP message: string event and object data fields are required.',
        'malformed_session_event',
      );
      return null;
    }
    return {
      type: 'WA_EMBEDDED_SIGNUP',
      event: parsed['event'],
      data: parsed['data'],
    };
  }

  private submitWhenReady(): void {
    const operation = this.operation;
    const code = this.authorizationCode;
    const session = this.signupSession;
    if (!operation || !code || !session || this.completionStarted) return;
    if (this.operationExpired()) {
      this.expireFlow();
      return;
    }

    this.completionStarted = true;
    this.phase.set('submitting');
    this.patchDiagnostics({
      stage: 'submitting_completion',
      code_received: true,
      session_received: true,
      connect_complete_reached: true,
      error_code: null,
    });
    this.clearHandshakeTimer();
    this.removeMessageListener();
    this.meta
      .completeConnection({
        operation_id: operation.operation_id,
        state: operation.state,
        code,
        session,
      })
      .pipe(timeout(API_RESPONSE_TIMEOUT_MS), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          if (this.operation?.operation_id !== operation.operation_id) return;
          this.authorizationCode = null;
          this.signupSession = null;
          if (response.success !== true) {
            this.failFlow(
              response.message?.trim() || 'WhatsApp connection completion was not successful.',
              'completion_response_unsuccessful',
            );
            return;
          }
          this.handleOperationData(response.data, 'completion');
        },
        error: (error: unknown) => {
          if (this.operation?.operation_id !== operation.operation_id) return;
          this.authorizationCode = null;
          this.signupSession = null;
          this.handleUncertainMutation(error, 'completion');
        },
      });
  }

  private handleOperationData(
    data: MetaWhatsAppConnectOperationData,
    stage: 'completion' | 'activation' | 'recovery',
  ): void {
    const outcome = this.operationOutcome(data);
    if (outcome === 'confirmation') {
      this.confirmationDetails.set(this.backendSenderDetails(data));
      this.phase.set('confirmation');
      this.patchDiagnostics({ stage: 'confirmation_required', error_code: null });
      return;
    }
    if (outcome === 'success') {
      this.finishSuccess();
      return;
    }
    if (outcome === 'failure') {
      this.failFlow(
        `WhatsApp connection operation ended with status: ${data.status}.`,
        `operation_${this.safeDiagnosticCode(data.status)}`,
      );
      return;
    }
    if (outcome === 'pending') {
      if (stage === 'recovery') this.scheduleRecovery();
      else this.recoverOperation();
      return;
    }
    if (stage === 'recovery') {
      this.failFlow(
        typeof data.status === 'string'
          ? `Cannot determine the WhatsApp connection result: operation response has unsupported data.status value "${data.status}".`
          : 'Cannot determine the WhatsApp connection result: operation response is missing data.status (string).',
        typeof data.status === 'string'
          ? 'unsupported_operation_status'
          : 'missing_operation_status',
      );
      return;
    }
    this.recoverOperation();
  }

  private handleUncertainMutation(error: unknown, stage: 'completion' | 'activation'): void {
    if (this.isUncertainMutationFailure(error)) {
      const timedOut = error instanceof TimeoutError;
      this.flowWarning.set(
        `${stage === 'activation' ? 'Activation' : 'Completion'} response ${timedOut ? 'timed out' : 'was uncertain'}. Checking the existing operation without resubmitting it.`,
      );
      this.patchDiagnostics({
        error_code: timedOut ? `${stage}_response_timeout` : `${stage}_response_uncertain`,
      });
      this.recoverOperation();
      return;
    }
    this.failFlow(
      this.errorMessage(
        error,
        stage === 'activation'
          ? 'Unable to activate the WhatsApp connection.'
          : 'Unable to complete WhatsApp onboarding.',
      ),
    );
  }

  private recoverOperation(): void {
    const operationId = this.operation?.operation_id;
    if (!operationId) {
      this.failFlow('Cannot recover the connection result: operation_id is missing.');
      return;
    }
    if (this.recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) {
      this.failFlow(
        `The connection result is still uncertain after ${MAX_RECOVERY_ATTEMPTS} status checks. No code exchange or activation was resubmitted.`,
      );
      return;
    }
    this.phase.set('recovering');
    this.recoveryAttempts += 1;
    this.patchDiagnostics({
      stage: 'recovering_operation',
      status_checks: this.recoveryAttempts,
    });
    this.meta
      .getConnectionOperation(operationId)
      .pipe(timeout(API_RESPONSE_TIMEOUT_MS), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          if (this.operation?.operation_id !== operationId) return;
          if (response.success !== true) {
            this.failFlow(
              response.message?.trim() || 'WhatsApp operation status lookup was not successful.',
              'operation_status_response_unsuccessful',
            );
            return;
          }
          this.handleOperationData(response.data, 'recovery');
        },
        error: (error: unknown) => {
          if (this.operation?.operation_id !== operationId) return;
          if (this.recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) {
            if (error instanceof TimeoutError) {
              this.failFlow(
                `The connection result could not be recovered because all ${MAX_RECOVERY_ATTEMPTS} operation status checks timed out.`,
                'operation_status_timeout',
              );
              return;
            }
            this.failFlow(
              this.errorMessage(
                error,
                `The connection result could not be recovered after ${MAX_RECOVERY_ATTEMPTS} status checks.`,
              ),
              'operation_status_error',
            );
            return;
          }
          this.scheduleRecovery();
        },
      });
  }

  private scheduleRecovery(): void {
    this.clearRecoveryTimer();
    this.recoveryTimer = setTimeout(() => this.recoverOperation(), RECOVERY_DELAY_MS);
  }

  private operationOutcome(data: MetaWhatsAppConnectOperationData): OperationOutcome {
    const status = typeof data.status === 'string' ? data.status.trim().toLowerCase() : '';
    if (data.confirmation_required === true || status === 'confirmation_required')
      return 'confirmation';
    if (SUCCESS_STATUSES.has(status)) return 'success';
    if (PENDING_STATUSES.has(status)) return 'pending';
    if (FAILURE_STATUSES.has(status)) return 'failure';
    return 'schema_missing';
  }

  private finishSuccess(): void {
    this.clearFlowResources();
    this.clearSensitiveFlowState();
    this.confirmationDetails.set('');
    this.phase.set('success');
    this.flowError.set('');
    this.flowWarning.set('');
    this.patchDiagnostics({ stage: 'completed', error_code: null });
    this.meta.announceChannelChanged();
    this.loadReadiness();
    this.refreshChannel();
  }

  private failFlow(message: string, errorCode = 'flow_failed'): void {
    this.clearFlowResources();
    this.clearSensitiveFlowState();
    this.phase.set('idle');
    this.flowError.set(message);
    this.patchDiagnostics({
      stage: 'failed',
      error_code: this.safeDiagnosticCode(errorCode),
    });
  }

  private resetFlow(): void {
    this.clearFlowResources();
    this.clearSensitiveFlowState();
    this.phase.set('idle');
    this.flowError.set('');
    this.flowWarning.set('');
    this.confirmationDetails.set('');
    this.diagnostics.set({
      stage: 'idle',
      code_received: false,
      session_received: false,
      connect_complete_reached: false,
      status_checks: 0,
      error_code: null,
    });
  }

  private clearSensitiveFlowState(): void {
    this.operation = null;
    this.authorizationCode = null;
    this.signupSession = null;
    this.sessionMessageSource = null;
    this.completionStarted = false;
    this.recoveryAttempts = 0;
  }

  private clearFlowResources(): void {
    this.removeMessageListener();
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
    this.clearRecoveryTimer();
    this.clearHandshakeTimer();
  }

  private clearRecoveryTimer(): void {
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
    this.recoveryTimer = null;
  }

  private scheduleHandshakeTimeout(): void {
    this.clearHandshakeTimer();
    this.handshakeTimer = setTimeout(() => {
      if (this.phase() !== 'launching' || this.completionStarted) return;
      const codeReceived = Boolean(this.authorizationCode);
      const sessionReceived = Boolean(this.signupSession);
      if (codeReceived && !sessionReceived) {
        this.failFlow(
          'Facebook authorization returned a code, but the WhatsApp signup session event was not received. /connect/complete was not called.',
          'session_timeout',
        );
      } else if (!codeReceived && sessionReceived) {
        this.failFlow(
          'The WhatsApp signup session completed, but Facebook did not return an authorization code. /connect/complete was not called.',
          'authorization_code_timeout',
        );
      } else {
        this.failFlow(
          'Facebook signup did not return an authorization code or a WhatsApp session event in time. /connect/complete was not called.',
          'handshake_timeout',
        );
      }
    }, HANDSHAKE_TIMEOUT_MS);
  }

  private clearHandshakeTimer(): void {
    if (this.handshakeTimer) clearTimeout(this.handshakeTimer);
    this.handshakeTimer = null;
  }

  private installMessageListener(): void {
    if (!this.isBrowser || this.listenerInstalled) return;
    this.document.defaultView?.addEventListener('message', this.handleWindowMessage);
    this.listenerInstalled = true;
  }

  private removeMessageListener(): void {
    if (!this.listenerInstalled) return;
    this.document.defaultView?.removeEventListener('message', this.handleWindowMessage);
    this.listenerInstalled = false;
  }

  private scheduleExpiry(expiresAt: string): void {
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    const delay = Date.parse(expiresAt) - Date.now();
    if (delay <= 0) {
      this.expireFlow();
      return;
    }
    this.expiryTimer = setTimeout(() => this.expireFlow(), Math.min(delay, 2_147_483_647));
  }

  private operationExpired(): boolean {
    return !this.operation || Date.parse(this.operation.expires_at) <= Date.now();
  }

  private expireFlow(): void {
    this.failFlow(
      'This one-time connection operation expired. Prepare a new connection and try again.',
      'operation_expired',
    );
  }

  private validateInitiation(data: MetaWhatsAppConnectInitiation): string {
    const missing: string[] = [];
    if (!this.stringValue(data.operation_id)) missing.push('data.operation_id');
    if (!this.stringValue(data.state)) missing.push('data.state');
    if (!this.stringValue(data.expires_at) || Number.isNaN(Date.parse(data.expires_at)))
      missing.push('data.expires_at');
    if (data.launch_mode !== 'facebook_js_sdk') missing.push('data.launch_mode=facebook_js_sdk');
    if (!this.stringValue(data.app_id)) missing.push('data.app_id');
    if (!this.stringValue(data.configuration_id)) missing.push('data.configuration_id');
    if (!this.stringValue(data.graph_api_version)) missing.push('data.graph_api_version');
    if (data.response_type !== 'code') missing.push('data.response_type=code');
    if (data.override_default_response_type !== true)
      missing.push('data.override_default_response_type=true');
    if (!this.isRecord(data.extras)) missing.push('data.extras');
    return missing.length
      ? `Cannot launch Facebook signup because the initiate response is missing or invalid: ${missing.join(', ')}.`
      : '';
  }

  private readinessContractErrors(value: unknown): string[] {
    if (!this.isRecord(value)) return ['Malformed readiness response: data must be an object.'];
    const errors: string[] = [];
    if (typeof value['oauth_configuration_ready'] !== 'boolean')
      errors.push(
        'Malformed readiness response: data.oauth_configuration_ready must be a boolean.',
      );
    if (!this.isStringArray(value['missing_settings']))
      errors.push('Malformed readiness response: data.missing_settings must be a string array.');
    if (!this.isStringArray(value['invalid_settings']))
      errors.push('Malformed readiness response: data.invalid_settings must be a string array.');
    if (!Array.isArray(value['settings'])) {
      errors.push('Malformed readiness response: data.settings must be an array.');
    } else {
      value['settings'].forEach((setting, index) => {
        if (!this.isRecord(setting)) {
          errors.push(`Malformed readiness response: data.settings[${index}] must be an object.`);
          return;
        }
        if (!this.stringValue(setting['name']))
          errors.push(
            `Malformed readiness response: data.settings[${index}].name must be a non-empty string.`,
          );
        if (typeof setting['present'] !== 'boolean')
          errors.push(
            `Malformed readiness response: data.settings[${index}].present must be a boolean.`,
          );
        if (typeof setting['format_valid'] !== 'boolean')
          errors.push(
            `Malformed readiness response: data.settings[${index}].format_valid must be a boolean.`,
          );
      });
    }
    if (value['onboarding_mode'] !== 'facebook_js_sdk')
      errors.push('Malformed readiness response: data.onboarding_mode must be "facebook_js_sdk".');
    if (typeof value['coexistence_requested'] !== 'boolean')
      errors.push('Malformed readiness response: data.coexistence_requested must be a boolean.');
    if (typeof value['hosted_signup_supports_coexistence_customization'] !== 'boolean')
      errors.push(
        'Malformed readiness response: data.hosted_signup_supports_coexistence_customization must be a boolean.',
      );
    if (value['callback_contract'] !== 'authenticated_code_handoff')
      errors.push(
        'Malformed readiness response: data.callback_contract must be "authenticated_code_handoff".',
      );
    return errors;
  }

  private readinessBlockingIssues(data: MetaWhatsAppConnectReadiness): string[] {
    const issues: string[] = [];
    const missing = new Set(data.missing_settings);
    const invalid = new Set(data.invalid_settings);
    for (const name of missing) issues.push(`Missing required setting: ${name}.`);
    for (const name of invalid) issues.push(`Invalid setting format: ${name}.`);
    for (const setting of data.settings) {
      if (!setting.present && !missing.has(setting.name))
        issues.push(`Missing required setting: ${setting.name}.`);
      else if (setting.present && !setting.format_valid && !invalid.has(setting.name))
        issues.push(`Invalid setting format: ${setting.name}.`);
    }
    return issues;
  }

  private backendSenderDetails(data: MetaWhatsAppConnectOperationData): string {
    const details: Record<string, unknown> = {};
    if (data.current_sender !== undefined) details['current_sender'] = data.current_sender;
    if (data.replacement_sender !== undefined)
      details['replacement_sender'] = data.replacement_sender;
    if (data.new_sender !== undefined) details['new_sender'] = data.new_sender;
    return Object.keys(details).length ? JSON.stringify(details, null, 2) : '';
  }

  private isUncertainMutationFailure(error: unknown): boolean {
    if (error instanceof TimeoutError) return true;
    return (
      error instanceof HttpErrorResponse &&
      (error.status === 0 || error.status === 408 || error.status === 429 || error.status >= 500)
    );
  }

  private patchDiagnostics(patch: Partial<OnboardingDiagnostics>): void {
    this.diagnostics.update((current) => ({ ...current, ...patch }));
  }

  private safeDiagnosticCode(value: unknown): string {
    const code = typeof value === 'string' || typeof value === 'number' ? String(value) : 'unknown';
    const normalized = code.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 80);
    return normalized || 'unknown';
  }

  private errorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error && !(error instanceof HttpErrorResponse)) return error.message;
    return leadErrorDetails(error, fallback).message;
  }

  private stringValue(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value : null;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.trim());
  }
}
