import {
  SECURITY_ID,
  SEC_ACCESS_TITLE,
  SEC_CANT,
  SEC_CANT_TITLE,
  SEC_CAN_READ,
  SEC_CAN_READ_TITLE,
  SEC_CREDENTIALS,
  SEC_CREDENTIALS_LEAD,
  SEC_DATA_AFTER,
  SEC_DATA_BEFORE,
  SEC_DATA_LINK,
  SEC_EXTERNAL_ID,
  SEC_EXTERNAL_ID_LEAD,
  SEC_READ_ONLY_ACCESS,
  SEC_REMOVE,
  SEC_REMOVE_LEAD,
  SEC_ROLE_DELETED,
} from './connectAwsCopy'
import { ContactLink, DisconnectSentence } from './connectAwsParts'

const CARD = 'bg-white rounded-2xl border border-slate-200 p-6'
const CARD_TITLE = 'text-label text-ink-muted uppercase tracking-[0.04em] mb-3.5'

/**
 * Board 7: what DevControl can read, what the role can't do with the recommended policy set, and how
 * access works and is removed. No CloudFormation wording until the template exists (PR D2).
 */
export function SecurityExplanation() {
  return (
    <section id={SECURITY_ID} data-testid="security-explanation" className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className={CARD}>
        <h3 className={CARD_TITLE}>{SEC_CAN_READ_TITLE}</h3>
        <ul className="space-y-2.5">
          {SEC_CAN_READ.map((item) => (
            <li key={item} className="flex items-start gap-2.5 text-ui text-ink-body">
              <span aria-hidden="true" className="text-ink-success font-semibold shrink-0">✓</span>{item}
            </li>
          ))}
        </ul>
      </div>

      <div className={CARD}>
        <h3 className={CARD_TITLE}>{SEC_CANT_TITLE}</h3>
        <ul className="space-y-2.5 mb-3">
          {SEC_CANT.map((item) => (
            <li key={item} className="flex items-start gap-2.5 text-ui text-ink-body">
              <span aria-hidden="true" className="text-ink-danger font-semibold shrink-0">✕</span>{item}
            </li>
          ))}
        </ul>
        <p className="text-meta text-ink-muted">{SEC_READ_ONLY_ACCESS}</p>
      </div>

      <div className={CARD}>
        <h3 className={CARD_TITLE}>{SEC_ACCESS_TITLE}</h3>
        <div className="space-y-3 text-ui text-ink-body">
          <p><strong className="text-ink">{SEC_EXTERNAL_ID_LEAD}</strong> {SEC_EXTERNAL_ID}</p>
          <p><strong className="text-ink">{SEC_CREDENTIALS_LEAD}</strong> {SEC_CREDENTIALS}</p>
          <p><strong className="text-ink">{SEC_REMOVE_LEAD}</strong> {SEC_REMOVE}</p>
          <p className="text-meta text-ink-muted">{SEC_ROLE_DELETED}</p>
          <p className="text-meta text-ink-muted">{SEC_DATA_BEFORE}<ContactLink>{SEC_DATA_LINK}</ContactLink>{SEC_DATA_AFTER}</p>
          <p className="text-meta text-ink-muted"><DisconnectSentence /></p>
        </div>
      </div>
    </section>
  )
}
