export type SenderProvider = 'gmail' | 'custom_smtp';
export type SenderAuthenticationType = 'app_password' | 'password';
export type SenderEncryption = 'STARTTLS' | 'TLS';
export type ConnectionStatus = 'not_tested' | 'success' | 'failed';

export interface SenderAccount {
  id: string;
  display_name: string;
  sender_email: string;
  provider: SenderProvider;
  authentication_type: SenderAuthenticationType;
  smtp_host: string;
  smtp_port: number;
  encryption: SenderEncryption;
  smtp_username: string;
  credentials_configured: boolean;
  reply_to: string | null;
  is_active: boolean;
  is_default: boolean;
  connection_status: ConnectionStatus;
  last_tested_at: string | null;
  last_test_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface SenderAccountCreateRequest {
  display_name: string;
  sender_email: string;
  provider: SenderProvider;
  authentication_type: SenderAuthenticationType;
  smtp_host: string;
  smtp_port: number;
  encryption: SenderEncryption;
  smtp_username: string;
  credential: string;
  reply_to: string | null;
  is_active: boolean;
  is_default: boolean;
}

export type SenderAccountUpdateRequest = Partial<Omit<SenderAccountCreateRequest, 'is_default'>>;

export interface SenderAccountListData {
  items: SenderAccount[];
  page: number;
  size: number;
  total: number;
}

export interface ApiDataResponse<T> {
  success: boolean;
  message?: string;
  data: T;
}

export interface ApiActionResponse {
  success: boolean;
  message: string;
}

export interface SenderConnectionTestData {
  sender_account_id: string;
  connection_status: 'success' | 'failed';
  last_tested_at: string;
}

export interface SenderConnectionTestResponse extends ApiActionResponse {
  data: SenderConnectionTestData;
}
