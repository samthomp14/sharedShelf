import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '../../lib/theme';

export interface LoanStep {
  label: string;
  done: boolean;
  date?: string; // already formatted, shown on the right of a done step
}

// The loan's history top to bottom: filled dots for steps that happened
// (with their date), hollow ones for what's still to come.
export function LoanTimeline({ steps }: { steps: LoanStep[] }) {
  return (
    <View>
      {steps.map((step, i) => {
        const last = i === steps.length - 1;
        // The rail below a dot is solid only if the next step happened too.
        const nextDone = !last && steps[i + 1].done;
        return (
          <View key={step.label} style={styles.step}>
            <View style={styles.rail}>
              <View style={[styles.dot, !step.done && styles.dotOpen]} />
              {!last && <View style={[styles.bar, !nextDone && styles.barOpen]} />}
            </View>
            <Text style={[styles.label, !step.done && styles.labelOpen]}>{step.label}</Text>
            {step.done && step.date && <Text style={styles.date}>{step.date}</Text>}
          </View>
        );
      })}
    </View>
  );
}

// A short left-to-right version for the borrower's side: dots joined by
// lines, labels underneath. The latest done step's label is emphasised.
export function LoanStepper({ steps }: { steps: Pick<LoanStep, 'label' | 'done'>[] }) {
  const current = steps.reduce((at, step, i) => (step.done ? i : at), -1);
  return (
    <View style={styles.stepper}>
      <View style={styles.stepperRail}>
        {steps.map((step, i) => (
          <View key={step.label} style={[styles.stepperSegment, i === 0 && styles.stepperFirst]}>
            {i > 0 && <View style={[styles.line, step.done && styles.lineDone]} />}
            <View style={[styles.smallDot, !step.done && styles.dotOpen]} />
          </View>
        ))}
      </View>
      <View style={styles.stepperLabels}>
        {steps.map((step, i) => (
          <Text
            key={step.label}
            style={[
              styles.stepperLabel,
              i === 0 ? styles.alignStart : i === steps.length - 1 ? styles.alignEnd : styles.alignCenter,
              i === current && styles.stepperLabelCurrent,
            ]}
          >
            {step.label}
          </Text>
        ))}
      </View>
    </View>
  );
}

const railOpen = '#c5ccd5';

const styles = StyleSheet.create({
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  rail: { width: 10, alignItems: 'center' },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 5,
    backgroundColor: colors.accent,
  },
  dotOpen: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: colors.textFaint,
  },
  bar: { width: 1.5, height: 22, backgroundColor: colors.accent },
  barOpen: { backgroundColor: railOpen },
  label: { flex: 1, fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.text },
  labelOpen: { color: colors.textFaint },
  date: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 20, color: colors.textFaint },

  stepper: { gap: 6 },
  stepperRail: { flexDirection: 'row', alignItems: 'center' },
  stepperSegment: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepperFirst: { flex: 0 },
  line: { flex: 1, height: 1.5, backgroundColor: railOpen },
  lineDone: { backgroundColor: colors.accent },
  smallDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent },
  stepperLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  stepperLabel: { flex: 1, fontFamily: fonts.regular, fontSize: 12, color: colors.textMuted },
  stepperLabelCurrent: { fontFamily: fonts.semibold, color: colors.text },
  alignStart: { textAlign: 'left' },
  alignCenter: { textAlign: 'center' },
  alignEnd: { textAlign: 'right' },
});
