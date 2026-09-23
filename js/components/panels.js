/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// History, bookmarks and settings, shown inside the browser window rather than
// as pages in a tab: a page in a tab is web content, and these need the app
// state, so keeping them here adds no privileged origin a web page could reach.

const React = require('react')
const PropTypes = require('prop-types')
const Immutable = require('immutable')
const ImmutableComponent = require('./immutableComponent')
const Dialog = require('./dialog')
const AppActions = require('../actions/appActions')
const WindowActions = require('../actions/windowActions')
const AppConfig = require('../constants/appConfig')
const SiteTags = require('../constants/siteTags')
const dnsProviders = require('../constants/dnsProviders')

const close = () => WindowActions.setPanel(null)

function Panel (props) {
  return (
    <Dialog className='panelDialog' onHide={close} isClickDismiss>
      <section className='panel' onClick={(e) => e.stopPropagation()}>
        <header>
          <h1>{props.title}</h1>
          <button className='panelClose' title='Close (Esc)' onClick={close}>×</button>
        </header>
        {props.children}
      </section>
    </Dialog>
  )
}

Panel.propTypes = { title: PropTypes.string, children: PropTypes.node }

const open = (location) => {
  WindowActions.newFrame({ location, openInForeground: true })
  close()
}

const whenOf = (date) => {
  const d = new Date(date)
  if (isNaN(d.getTime())) {
    return ''
  }
  const today = new Date()
  return d.toDateString() === today.toDateString()
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString()
}

/**
 * History or bookmarks: a searchable list, newest first.
 */
class SitesPanel extends React.Component {
  constructor (props) {
    super(props)
    this.state = { query: '' }
  }

  get entries () {
    const sites = this.props.sites || Immutable.List()
    const bookmarks = this.props.mode === 'bookmarks'
    const query = this.state.query.trim().toLowerCase()
    return sites
      .filter(site => {
        const tags = site.get('tags') || Immutable.List()
        return bookmarks ? tags.includes(SiteTags.BOOKMARK) : tags.size === 0
      })
      .filter(site => !query ||
        (site.get('title') || '').toLowerCase().includes(query) ||
        (site.get('location') || '').toLowerCase().includes(query))
      .sortBy(site => -(new Date(site.get('lastAccessed')).getTime() || 0))
      .take(500)
  }

  remove (site) {
    if (this.props.mode === 'bookmarks') {
      AppActions.removeSite(site, SiteTags.BOOKMARK)
    } else {
      AppActions.removeHistoryEntry(site.get('location'))
    }
  }

  render () {
    const bookmarks = this.props.mode === 'bookmarks'
    const entries = this.entries
    return (
      <Panel title={bookmarks ? 'Bookmarks' : 'History'}>
        <div className='panelToolbar'>
          <input
            type='search'
            autoFocus
            placeholder={bookmarks ? 'Search bookmarks' : 'Search history'}
            value={this.state.query}
            onChange={(e) => this.setState({ query: e.target.value })}
          />
          {!bookmarks
            ? <button onClick={() => AppActions.clearHistory()}>Clear history</button>
            : null}
        </div>
        <ul className='siteList'>
          {entries.size === 0
            ? <li className='empty'>{this.state.query ? 'Nothing matches.' : bookmarks ? 'No bookmarks yet.' : 'No history yet.'}</li>
            : entries.map(site =>
              <li key={site.get('location')}>
                <a onClick={() => open(site.get('location'))} title={site.get('location')}>
                  <span className='siteTitle'>{site.get('title') || site.get('location')}</span>
                  <span className='siteLocation'>{site.get('location')}</span>
                </a>
                <span className='siteWhen'>{whenOf(site.get('lastAccessed'))}</span>
                <button className='siteRemove' title='Remove' onClick={() => this.remove(site)}>×</button>
              </li>
            )}
        </ul>
      </Panel>
    )
  }
}

SitesPanel.propTypes = { sites: PropTypes.object, mode: PropTypes.string }

const protections = [
  ['adblock', 'Block ads'],
  ['trackingProtection', 'Block trackers'],
  ['phishing', 'Block phishing and malware sites'],
  ['privacyHeaders', 'Block third-party cookies'],
  ['gpc', 'Send Global Privacy Control'],
  ['httpsUpgrade', 'Upgrade connections to HTTPS'],
  ['httpsOnly', 'HTTPS-only: never fall back to HTTP'],
  ['clearOnExit', 'Clear cookies and site data when Brave closes']
]

class SettingsPanel extends ImmutableComponent {
  enabled (name) {
    const fromState = this.props.appState.getIn([name, 'enabled'])
    return fromState === undefined ? !!(AppConfig[name] && AppConfig[name].enabled) : fromState
  }

  render () {
    const theme = this.props.appState.get('theme') || 'system'
    const dns = this.props.appState.get('dnsProvider') || 'quad9'
    return (
      <Panel title='Settings'>
        <div className='settings'>
          <h2>Protection</h2>
          {protections.map(([name, label]) =>
            <label key={name} className='setting'>
              <input
                type='checkbox'
                checked={this.enabled(name)}
                onChange={() => AppActions.setResourceEnabled(name, !this.enabled(name))}
              />
              {label}
            </label>
          )}
          <p className='settingNote'>
            Turn protections off for just one site from the lock icon in the address bar.
          </p>

          <h2>Secure DNS</h2>
          {Object.keys(dnsProviders).map(name =>
            <label key={name} className='setting'>
              <input
                type='radio'
                name='dns'
                checked={dns === name}
                onChange={() => AppActions.setDnsProvider(name)}
              />
              {dnsProviders[name].label}
              <span className='settingHint'> - {dnsProviders[name].note}</span>
            </label>
          )}
          <p className='settingNote'>Takes effect the next time Brave starts.</p>

          <h2>Appearance</h2>
          {[['system', 'Same as the system'], ['light', 'Light'], ['dark', 'Dark']].map(([value, label]) =>
            <label key={value} className='setting'>
              <input
                type='radio'
                name='theme'
                checked={theme === value}
                onChange={() => AppActions.setTheme(value)}
              />
              {label}
            </label>
          )}

          <h2>About</h2>
          <p className='settingNote'>
            Brave 2016 {process.env.APP_VERSION} - a hobby revival of the 2016
            Brave browser, not safe for everyday use.
          </p>
          <button onClick={() => AppActions.checkForUpdates()}>Check for updates</button>
        </div>
      </Panel>
    )
  }
}

SettingsPanel.propTypes = { appState: PropTypes.object }

module.exports = { SitesPanel, SettingsPanel }
