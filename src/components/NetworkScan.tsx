import type { NetworkState } from '../lib/network'
import { plural } from '../lib/format'
import { Icon } from './Icon'

/** Progress line for the in-browser scan of your follows' libraries. */
export function NetworkScan({ network }: { network: NetworkState & { refresh: () => void } }) {
  const { status, toScan, scanned, followCount, readers, usedIndex, failed } = network
  if (status === 'idle') return null
  const percent = toScan ? Math.round((scanned / toScan) * 100) : 0
  return (
    <div className="scan" aria-live="polite">
      {status === 'loading' && (
        <>
          <span>
            {toScan
              ? `Checking ${plural(toScan, 'library', 'libraries')} in your network… ${scanned}/${toScan}`
              : 'Finding who you follow…'}
          </span>
          <div className="scan-bar">
            <span style={{ width: `${percent}%` }} />
          </div>
        </>
      )}
      {status === 'done' && (
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span>
            {plural(readers.length, 'reader')} among {plural(followCount, 'account')} you follow
            {usedIndex ? '' : ' (every account checked)'}
            {failed ? ` · ${failed} couldn't be reached` : ''}
          </span>
          <button className="btn btn-quiet btn-sm" onClick={network.refresh}>
            <Icon name="refresh" size={16} /> Refresh
          </button>
        </div>
      )}
      {status === 'error' && (
        <div className="notice notice-error row" style={{ justifyContent: 'space-between' }}>
          <span>Couldn't load your network: {network.error}</span>
          <button className="btn btn-sm" onClick={network.refresh}>
            Try again
          </button>
        </div>
      )}
    </div>
  )
}
