/*
 * Set when someone presses CONNECT WALLET on the landing page while signed
 * out. The role chooser only follows that deliberate sign-in; the hero buttons
 * and the app pages already know where the person is going.
 */
let requested = false;

export const requestRoleChoice = () => {
  requested = true;
};

/** True once per request: reading it clears it. */
export const takeRoleChoiceRequest = (): boolean => {
  const value = requested;
  requested = false;
  return value;
};
