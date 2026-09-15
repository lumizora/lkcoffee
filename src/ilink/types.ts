export type IlinkAccount = {
  botToken: string;
  botId: string;
  baseUrl: string;
  userId?: string;
  savedAt?: string;
};

export type IlinkMessage = {
  fromUserId: string;
  contextToken?: string;
  text?: string;
  voice?: { transcript?: string; pcm?: Buffer };
};

export type OnIlinkMessage = (message: IlinkMessage) => Promise<string | undefined>;

export type IlinkRawMessage = {
  from_user_id?: string;
  context_token?: string;
  message_id?: string | number;
  message_type?: number;
  item_list?: Array<{
    type?: number;
    text_item?: { text?: string };
    voice_item?: {
      text?: string;
      media?: { full_url?: string; encrypt_query_param?: string; aes_key?: string };
    };
  }>;
};

export type GetUpdatesResponse = {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  get_updates_buf?: string;
  msgs?: IlinkRawMessage[];
};
