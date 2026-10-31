export interface GlossaryEntry {
  term: string
  text: string
}

export const startHere: string[] = [
  'Check the limits banner: this is an experimental prototype, not a life-safety instrument.',
  'Read the Next action bar. It states the single most useful thing to do now.',
  'Watch the readout strip for monitoring, both devices, RF state, environment and open incidents.',
  'Review any incident in the workspace: evidence first, then acknowledge. Closing requires an acknowledgement.',
  'Only run the 30-second empty-room calibration in the Signal lab before relying on the RF panel.',
]

export const pageMap: GlossaryEntry[] = [
  { term: 'Readout strip', text: 'Six live values: monitoring, ESP32 node, Arduino Mega, RF state, environment and active incidents.' },
  { term: 'RF observation', text: 'What the Wi-Fi signal looks like right now, with the chart of the periodicity score over time.' },
  { term: 'Environmental sensor', text: 'Raw ADC counts from the uncalibrated gas sensor, with baseline and elevated-above references.' },
  { term: 'Incidents', text: 'The open cases a human is expected to review, with evidence and acknowledgement controls.' },
  { term: 'Event timeline', text: 'An auditable, newest-first record of everything the console and devices reported.' },
  { term: 'Device commands', text: 'Every command sent to the Arduino and how far it got through the acknowledgement chain.' },
  { term: 'Sensor nodes', text: 'Known radio nodes with their physical placement, used to interpret the RF data.' },
  { term: 'Physical controls', text: 'What the keypad and LCD are doing; simulation controls appear only with a simulated backend.' },
  { term: 'Signal lab', text: 'The existing live waveform, spectrum and calibration page served by the backend.' },
]

export const rfGlossary: GlossaryEntry[] = [
  { term: 'NO_DATA', text: 'No CSI packets have arrived yet, so nothing can be said about the signal.' },
  { term: 'COLLECTING', text: 'Packets are arriving, but the window is too short or too noisy to judge.' },
  { term: 'INSUFFICIENT_DATA', text: 'Not enough clean data for a judgement. This is different from zero.' },
  { term: 'LOW_QUALITY', text: 'The link is too weak or inconsistent to interpret.' },
  { term: 'NO_CLEAR_PERIODIC_PATTERN', text: 'The recent window does not contain a clear repeating pattern.' },
  { term: 'PERIODIC_PATTERN_OBSERVED', text: 'A repeating pattern is present. It is an observation for review, not proof of a person.' },
  { term: 'REVIEW_RECOMMENDED', text: 'The pattern held long enough that a human should inspect the evidence.' },
]

export const qualityGlossary: GlossaryEntry[] = [
  { term: 'Data quality', text: 'How clean the input is: none, low, fair or good. It is not a probability of anything.' },
  { term: 'Confidence', text: 'How consistent and clean the evidence is, never the probability that a person is present.' },
  { term: 'Periodicity score', text: 'A 0 to 1 measure of how strongly the signal repeats. It is a signal feature, not a diagnosis.' },
  { term: 'Candidate rate', text: 'Repeats per minute. A candidate, not a breathing rate, and not a medical measurement.' },
  { term: 'Gas counts', text: 'Raw 0 to 1023 ADC values from an uncalibrated sensor. The console never converts them to ppm or names a gas.' },
  { term: 'Baseline', text: 'The reference ADC level captured in the current environment. Re-baseline only in a known clean state.' },
  { term: 'Elevated above', text: 'A simple threshold set above the baseline. It is a prompt to look, not a safety limit.' },
]

export const incidentGlossary: GlossaryEntry[] = [
  { term: 'Open', text: 'Waiting for a human to review the evidence.' },
  { term: 'Acknowledged', text: 'A human has seen it and recorded that fact. It can now be closed.' },
  { term: 'Closed', text: 'Reviewed and finished. The record stays in the event timeline.' },
]

export const commandGlossary: GlossaryEntry[] = [
  { term: 'Created', text: 'The backend recorded the command but has not written it to the link yet.' },
  { term: 'Sent', text: 'Written to the serial port. This does not prove the device received it.' },
  { term: 'Received', text: 'The device confirmed it received the command.' },
  { term: 'Executed', text: 'The device reported that it carried out the command.' },
  { term: 'Acknowledged', text: 'An operator confirmed the result. This is the end of the chain.' },
  { term: 'Failed', text: 'The command could not be delivered or the device reported failure.' },
  { term: 'Timed out', text: 'No acknowledgement arrived within the allowed window. The command is shown as unconfirmed.' },
]

export const whenWrong: string[] = [
  'The API is unreachable: start the backend with python app.py, or set the address in Settings. Demo data is not live data.',
  'The ESP32 is offline: check the USB data cable, the 2.4 GHz hotspot, the correct COM port, and close any serial monitor.',
  'Readings look frozen: look at "updated N s ago" and the feed indicator before trusting any value.',
  'The gas reading jumps: the sensor is uncalibrated. Re-baseline only in a known clean environment.',
  'A command stays "sent": the Arduino never confirmed. Check the link, the port and the cable; commands time out after five seconds.',
]

export const whatThisIsNot: string[] = [
  'Not a life-safety instrument and not certified for emergency use.',
  'Not a detector: the RF panel reports observations for human review, not the presence of a person.',
  'Not a gas meter: readings are raw ADC counts from an uncalibrated sensor, not ppm.',
  'Not a record of certainty: confidence describes evidence quality, not the chance that something is happening.',
]
