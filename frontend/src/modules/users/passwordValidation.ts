export const temporaryPasswordRequirements = [
  { key: 'minLength', label: '10 or more characters', test: (password: string) => password.length >= 10 },
  { key: 'uppercase', label: 'uppercase letter', test: (password: string) => /[A-Z]/.test(password) },
  { key: 'lowercase', label: 'lowercase letter', test: (password: string) => /[a-z]/.test(password) },
  { key: 'number', label: 'number', test: (password: string) => /\d/.test(password) },
  { key: 'symbol', label: 'symbol', test: (password: string) => /[^A-Za-z0-9]/.test(password) },
] as const;

export type TemporaryPasswordRequirementKey = typeof temporaryPasswordRequirements[number]['key'];
export type TemporaryPasswordValidation = Record<TemporaryPasswordRequirementKey, boolean> & { valid: boolean };

export function validateTemporaryPassword(password: string): TemporaryPasswordValidation {
  const result = Object.fromEntries(
    temporaryPasswordRequirements.map(requirement => [requirement.key, requirement.test(password)]),
  ) as Record<TemporaryPasswordRequirementKey, boolean>;
  return { ...result, valid: temporaryPasswordRequirements.every(requirement => result[requirement.key]) };
}

const uppercaseCharacters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const lowercaseCharacters = 'abcdefghijkmnopqrstuvwxyz';
const numberCharacters = '23456789';
const symbolCharacters = '!@#$%^&*()-_=+[]{}';
const allCharacters = `${uppercaseCharacters}${lowercaseCharacters}${numberCharacters}${symbolCharacters}`;

function secureRandomIndex(maxExclusive: number) {
  if (!globalThis.crypto?.getRandomValues) throw new Error('Secure password generation is not available in this browser.');
  const maximumAcceptedValue = Math.floor(0x1_0000_0000 / maxExclusive) * maxExclusive;
  const randomValue = new Uint32Array(1);
  do {
    globalThis.crypto.getRandomValues(randomValue);
  } while (randomValue[0] >= maximumAcceptedValue);
  return randomValue[0] % maxExclusive;
}

function secureCharacter(characters: string) {
  return characters[secureRandomIndex(characters.length)];
}

export function generateTemporaryPassword(length = 16) {
  const safeLength = Math.max(14, Math.floor(length));
  const characters = [
    secureCharacter(uppercaseCharacters),
    secureCharacter(lowercaseCharacters),
    secureCharacter(numberCharacters),
    secureCharacter(symbolCharacters),
  ];
  while (characters.length < safeLength) characters.push(secureCharacter(allCharacters));
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swapIndex = secureRandomIndex(index + 1);
    [characters[index], characters[swapIndex]] = [characters[swapIndex], characters[index]];
  }
  const password = characters.join('');
  if (!validateTemporaryPassword(password).valid) throw new Error('Secure password generation failed validation.');
  return password;
}
