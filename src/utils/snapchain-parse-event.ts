export type HubEventMessage = {
  data: {
    type:
      | 'MESSAGE_TYPE_NONE'
      | 'MESSAGE_TYPE_CAST_ADD'
      | 'MESSAGE_TYPE_CAST_REMOVE'
      | 'MESSAGE_TYPE_REACTION_ADD'
      | 'MESSAGE_TYPE_REACTION_REMOVE'
      | 'MESSAGE_TYPE_LINK_ADD'
      | 'MESSAGE_TYPE_LINK_REMOVE'
      | 'MESSAGE_TYPE_VERIFICATION_ADD_ETH_ADDRESS'
      | 'MESSAGE_TYPE_VERIFICATION_REMOVE'
      | 'MESSAGE_TYPE_USER_DATA_ADD'
      | 'MESSAGE_TYPE_USERNAME_PROOF';
    fid: number | string;
    timestamp: number;
    network: string;
    body: Record<string, unknown> | string;
    cast_add_body?: {
      embeds?: { url?: string; embed?: string }[];
    };
  };
  hash: string;
  hash_scheme: string;
  signature: string;
  signature_scheme: string;
  signer: string;
  data_bytes: string;
};

function getValueFromObject(obj: Record<string, unknown>, path: string): unknown {
  if (!obj || !path || !path.length) {
    return undefined;
  }

  const parts = path.replace(/\.\./g, '.__dot__').split('.');
  if (parts[0].startsWith('__dot__')) {
    parts[0] = parts[0].replace(/__dot__/, '.');
  }

  if (parts.length === 1) {
    return obj[parts[0]] as string | undefined;
  }

  return getValueFromObject(obj[parts[0]] as Record<string, unknown>, parts.slice(1).join('.'));
}

export function snapchainTimestampFromMsg(msg: Record<string, unknown>): Date {
  return new Date(
    parseInt((msg.timestamp as string) || (msg as { data: { timestamp: string } }).data?.timestamp) * 1000 +
      1609459200000
  );
}

export function snapchainParseEvent(evt: HubEventMessage) {
  if (!evt?.data?.type) {
    return null;
  }

  const data = evt.data;

  const processed: Record<string, unknown> = {
    fid: data.fid,
    signer: evt.signer,
    timestamp: snapchainTimestampFromMsg(data).toISOString(),
  };

  switch (data.type) {
    case 'MESSAGE_TYPE_CAST_ADD':
      processed._dataType = 'cast';
      processed.hash = evt.hash;
      processed.embeds = getValueFromObject(data, 'cast_add_body.embeds');
      processed.parentCastUrl = getValueFromObject(data, 'cast_add_body.parent_url');
      processed.parentCastFid = getValueFromObject(data, 'cast_add_body.parent_cast_id.fid');
      processed.parentCastHash = getValueFromObject(data, 'cast_add_body.parent_cast_id.hash');
      processed.text = getValueFromObject(data, 'cast_add_body.text');
      processed.mentions = getValueFromObject(data, 'cast_add_body.mentions');
      processed.mentionsPositions = getValueFromObject(data, 'cast_add_body.mentions_positions');
      processed.deletedAt = '';
      break;
    case 'MESSAGE_TYPE_CAST_REMOVE':
      processed._dataType = 'cast';
      processed.hash = getValueFromObject(data, 'cast_remove_body.target_hash');
      if (typeof processed.hash === 'string' && !processed.hash?.startsWith('0x')) {
        processed.hash = '0x' + Buffer.from(processed.hash, 'base64').toString('hex');
      }
      processed.deletedAt = processed.timestamp;
      break;
    case 'MESSAGE_TYPE_REACTION_ADD':
    case 'MESSAGE_TYPE_REACTION_REMOVE':
      processed._dataType = 'reaction';
      processed.targetCastFid = getValueFromObject(data, 'reaction_body.target_cast_id.fid');
      processed.targetCastHash = getValueFromObject(data, 'reaction_body.target_cast_id.hash');
      processed.type = (getValueFromObject(data, 'reaction_body.type') as string)?.split('_TYPE_').pop().toLowerCase();
      if (data.type === 'MESSAGE_TYPE_REACTION_REMOVE') {
        processed.deletedAt = processed.timestamp;
      } else {
        processed.deletedAt = '';
      }
      break;
    case 'MESSAGE_TYPE_LINK_ADD':
    case 'MESSAGE_TYPE_LINK_REMOVE':
      processed._dataType = 'link';
      processed.target_fid = getValueFromObject(data, 'link_body.target_fid');
      processed.type = getValueFromObject(data, 'link_body.type');
      if (data.type === 'MESSAGE_TYPE_LINK_REMOVE') {
        processed.deletedAt = processed.timestamp;
      } else {
        processed.deletedAt = '';
      }
      break;
    case 'MESSAGE_TYPE_VERIFICATION_ADD_ETH_ADDRESS':
      processed._dataType = 'verification';
      processed.address = getValueFromObject(data, 'verification_add_address_body.address') as string;
      if ((processed.address as string)?.startsWith('0x')) {
        processed.address = (processed.address as string).toLowerCase();
      }
      processed.deletedAt = '';
      break;
    case 'MESSAGE_TYPE_VERIFICATION_REMOVE':
      processed._dataType = 'verification';
      processed.address = getValueFromObject(data, 'verification_remove_body.address') as string;
      if ((processed.address as string)?.startsWith('0x')) {
        processed.address = (processed.address as string).toLowerCase();
      }
      processed.deletedAt = processed.timestamp;
      break;
    case 'MESSAGE_TYPE_USER_DATA_ADD': {
      processed._dataType = 'user_data';
      const key = (getValueFromObject(data, 'user_data_body.type') as string)?.split('_').pop().toLowerCase();
      if (key) {
        processed.data = {
          [key]: getValueFromObject(data, 'user_data_body.value'),
        };
      }
      break;
    }
    case 'MESSAGE_TYPE_USERNAME_PROOF':
      return null;
    default:
      return null;
  }

  for (const k in processed) {
    if (processed[k] === null || processed[k] === undefined) {
      delete processed[k];
    }
    if (k === 'deletedAt' && processed[k] === '') {
      processed[k] = null;
    }
    if ((k.endsWith('Hash') || k === 'hash') && processed[k] && !(processed[k] as string).startsWith('0x')) {
      processed[k] = '0x' + Buffer.from(processed[k] as string, 'base64').toString('hex');
    }
  }

  return processed;
}
