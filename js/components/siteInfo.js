/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

const React = require('react')
const PropTypes = require('prop-types')
const ImmutableComponent = require('./immutableComponent')
const cx = require('../lib/classSet.js')
const Dialog = require('./dialog')
const WindowActions = require('../actions/windowActions')
const AppActions = require('../actions/appActions')

class SiteInfo extends ImmutableComponent {
  get host () {
    try {
      const u = new window.URL(this.props.frameProps.get('location'))
      return /^https?:$/.test(u.protocol) ? u.hostname : null
    } catch (e) {
      return null
    }
  }

  // Ads, trackers and third-party cookies for this one site; phishing
  // blocking, HTTPS and certificate checks stay on regardless.
  toggleShields (e) {
    e.stopPropagation()
    AppActions.setSiteShields(this.host, !this.props.shieldsDown)
    // the main process reloads the site's tabs once the setting is stored
  }

  get isExtendedValidation () {
    return this.props.frameProps.getIn(['security', 'isExtendedValidation'])
  }

  get isSecure () {
    return this.props.frameProps.getIn(['security', 'isSecure'])
  }

  get isBlockingTrackedContent () {
    return this.blockedByTrackingList && this.blockedByTrackingList.size > 0
  }

  get isMixedContent () {
    return this.props.frameProps.getIn(['security', 'isMixedContent'])
  }

  get blockedByTrackingList () {
    return this.props.frameProps.getIn(['trackingProtection', 'blocked'])
  }

  get isTPListShown () {
    return this.props.siteInfo.get('expandTrackingProtection')
  }

  get blockedAds () {
    return this.props.frameProps.getIn(['adblock', 'blocked'])
  }

  get isBlockingAds () {
    return this.blockedAds && this.blockedAds.size > 0
  }

  get isBlockedAdsShown () {
    return this.props.siteInfo.get('expandAdblock')
  }

  onToggleTPList (e) {
    WindowActions.setSiteInfoVisible(true, !this.isTPListShown)
    e.stopPropagation()
  }

  onToggleBlockedAds (e) {
    WindowActions.setSiteInfoVisible(true, undefined, !this.isBlockedAdsShown)
    e.stopPropagation()
  }

  render () {
    let secureIcon
    if (this.isSecure && !this.isMixedContent) {
      secureIcon = (
        <li>
          <span
            className={cx({
              fa: true,
              'fa-lock': true,
              extendedValidation: this.isExtendedValidation
            })}
          />
          <span data-l10n-id='secureConnection' />
        </li>
      )
    } else if (this.isMixedContent) {
      secureIcon = <li><span className='fa fa-unlock-alt' /><span data-l10n-id='mixedConnection' /></li>
    } else {
      secureIcon = <li><span className='fa fa-unlock' /><span data-l10n-id='insecureConnection' /></li>
    }

    const trackingSummary = this.isBlockingTrackedContent && (
      <li>
        <a onClick={this.onToggleTPList.bind(this)}>
          <span className='fa fa-shield' />
          <span
            data-l10n-args={JSON.stringify({ blockedTrackingElementsSize: this.blockedByTrackingList.size })}
            data-l10n-id='blockedTrackingElements'
          />
        </a>
      </li>
    )
    const trackingList = this.isTPListShown && this.blockedByTrackingList &&
      this.blockedByTrackingList.size > 0 && (
        <li>
          <ul>
            {this.blockedByTrackingList.map(site => <li key={site}>{site}</li>)}
          </ul>
        </li>
    )
    const adsSummary = this.isBlockingAds && (
      <li>
        <a onClick={this.onToggleBlockedAds.bind(this)}>
          <span className='fa fa-shield' />
          <span
            data-l10n-args={JSON.stringify({ blockedAdsSize: this.blockedAds.size })}
            data-l10n-id='blockedAds'
          />
        </a>
      </li>
    )
    const adsList = this.isBlockingAds && this.isBlockedAdsShown && (
      <li>
        <ul>
          {this.blockedAds.map(site => <li key={site}>{site}</li>)}
        </ul>
      </li>
    )

    const shields = this.host && (
      <li className='shields'>
        <label onClick={(e) => e.stopPropagation()}>
          <input
            type='checkbox'
            checked={!this.props.shieldsDown}
            onChange={this.toggleShields.bind(this)}
          />
          Protections on {this.host}
        </label>
        {this.props.shieldsDown && (
          <div className='shieldsNote'>
            Ads, trackers and third-party cookies are allowed here.
            Phishing blocking and HTTPS stay on.
          </div>
        )}
      </li>
    )

    return (
      <Dialog onHide={this.props.onHide} className='siteInfo' isClickDismiss>
        <ul>
          {shields || null}
          {secureIcon}
          {trackingSummary || null}
          {trackingList || null}
          {adsSummary || null}
          {adsList || null}
        </ul>
      </Dialog>
    )
  }
}

SiteInfo.propTypes = {
  frameProps: PropTypes.object,
  shieldsDown: PropTypes.bool,
  siteInfo: PropTypes.object,
  onHide: PropTypes.func
}

module.exports = SiteInfo
