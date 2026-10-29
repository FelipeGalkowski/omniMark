import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MARKETPLACES, marketplaceChartColor } from './data'
const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.css'), 'utf8')

function luminance(hex: string) {
  const channels = hex.slice(1).match(/../g)!.map(value => parseInt(value,16)/255).map(value => value <= .04045 ? value/12.92 : ((value+.055)/1.055)**2.4)
  return channels[0]*.2126 + channels[1]*.7152 + channels[2]*.0722
}
function contrast(a: string, b: string) {
  const x = luminance(a), y = luminance(b)
  return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)
}
function tokens(dark: boolean) {
  const values: Record<string,string> = {}
  for (const block of css.matchAll(/(:root|\[data-theme="dark"\])\s*\{([^}]+)\}/g)) {
    if (block[1] !== ':root' && !dark) continue
    for (const value of block[2].matchAll(/(--[\w-]+):\s*(#[\da-fA-F]{6})/g)) values[value[1]] = value[2]
  }
  return values
}
it.each([false,true])('keeps semantic messages and auxiliary text readable in dark=%s', dark => {
  const colors = tokens(dark)
  for (const state of ['error','warning','success','info','refund']) {
    for (const background of [`--${state}-bg`,'--sf']) expect(contrast(colors[`--${state}-text`], colors[background]), `${state} on ${background}`).toBeGreaterThanOrEqual(4.5)
  }
  expect(contrast(colors['--danger-text'], colors['--danger-bg'])).toBeGreaterThanOrEqual(4.5)
  for (const text of ['--t3','--t4']) for (const bg of ['--sf','--sf2','--sf3']) expect(contrast(colors[text],colors[bg]), `${text} on ${bg}`).toBeGreaterThanOrEqual(4.5)
})
it.each([false,true])('keeps marketplace graph series distinct from their surface in dark=%s', dark => {
  const colors = tokens(dark)
  for (const market of MARKETPLACES) expect(contrast(marketplaceChartColor(market.id,dark),colors['--sf']),market.id).toBeGreaterThanOrEqual(3)
})
