export const TAG_PALETTE = {
  blue: '#3b82f6', violet: '#a855f7', green: '#22c55e', amber: '#fbbf24',
  rose: '#f43f5e', cyan: '#06b6d4', orange: '#f97316', slate: '#94a3b8',
};

export function normalizeColor(value) {
  const color = TAG_PALETTE[value] || value;
  if (typeof color !== 'string' || !/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(color)) throw new Error('Use a hex color, such as #3B82F6.');
  return (color.length === 4 ? `#${[...color.slice(1)].map(character => character.repeat(2)).join('')}` : color).toLowerCase();
}

const rgb = hex => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));
const hex = channels => `#${channels.map(channel => Math.round(channel).toString(16).padStart(2, '0')).join('')}`;
const mix = (a, b, amount) => a.map((channel, index) => channel * (1 - amount) + b[index] * amount);
const luminance = channels => channels.map(channel => { const value = channel / 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4; }).reduce((total, channel, index) => total + channel * [.2126, .7152, .0722][index], 0);

export function tagAppearance(value = 'blue') {
  const color = normalizeColor(value), channels = rgb(color), background = mix(channels, [255, 255, 255], .9);
  let text = channels;
  for (let step = 0; step <= 10; step++) {
    text = mix(channels, [0, 0, 0], step / 10);
    if ((luminance(background) + .05) / (luminance(text) + .05) >= 4.5) break;
  }
  return { '--tag-color': color, '--tag-text': hex(text), '--tag-soft': hex(background), '--tag-border': hex(mix(channels, [255, 255, 255], .6)) };
}
