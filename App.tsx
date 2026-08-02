import { useState } from 'react';
import { Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';

type Operator = '+' | '-' | '×' | '÷';

function compute(a: number, b: number, op: Operator): number {
  switch (op) {
    case '+':
      return a + b;
    case '-':
      return a - b;
    case '×':
      return a * b;
    case '÷':
      return b === 0 ? NaN : a / b;
  }
}

const BUTTON_ROWS: string[][] = [
  ['C', '±', '%', '÷'],
  ['7', '8', '9', '×'],
  ['4', '5', '6', '-'],
  ['1', '2', '3', '+'],
  ['0', '.', '='],
];

export default function App() {
  const [display, setDisplay] = useState('0');
  const [stored, setStored] = useState<number | null>(null);
  const [pendingOp, setPendingOp] = useState<Operator | null>(null);
  const [awaitingOperand, setAwaitingOperand] = useState(false);

  function inputDigit(digit: string) {
    if (awaitingOperand) {
      setDisplay(digit);
      setAwaitingOperand(false);
    } else {
      setDisplay(display === '0' ? digit : display + digit);
    }
  }

  function inputDecimal() {
    if (awaitingOperand) {
      setDisplay('0.');
      setAwaitingOperand(false);
      return;
    }
    if (!display.includes('.')) setDisplay(display + '.');
  }

  function clearAll() {
    setDisplay('0');
    setStored(null);
    setPendingOp(null);
    setAwaitingOperand(false);
  }

  function toggleSign() {
    setDisplay((d) => (d.startsWith('-') ? d.slice(1) : d.startsWith('0') && d === '0' ? d : '-' + d));
  }

  function inputPercent() {
    setDisplay(String(parseFloat(display) / 100));
  }

  function applyOperator(op: Operator | '=') {
    const value = parseFloat(display);

    if (pendingOp && !awaitingOperand && stored !== null) {
      const result = compute(stored, value, pendingOp);
      setStored(op === '=' ? null : result);
      setDisplay(String(result));
      setPendingOp(op === '=' ? null : op);
    } else {
      setStored(value);
      setPendingOp(op === '=' ? null : op);
    }
    setAwaitingOperand(true);
  }

  function onPress(key: string) {
    if (key === 'C') return clearAll();
    if (key === '±') return toggleSign();
    if (key === '%') return inputPercent();
    if (key === '=') return applyOperator('=');
    if (['+', '-', '×', '÷'].includes(key)) return applyOperator(key as Operator);
    if (key === '.') return inputDecimal();
    return inputDigit(key);
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <View style={styles.displayWrap}>
        <Text style={styles.display} numberOfLines={1} adjustsFontSizeToFit>
          {display}
        </Text>
      </View>
      <View style={styles.keypad}>
        {BUTTON_ROWS.map((row, i) => (
          <View style={styles.row} key={i}>
            {row.map((key) => (
              <Pressable
                key={key}
                onPress={() => onPress(key)}
                style={({ pressed }) => [
                  styles.button,
                  key === '0' && styles.wideButton,
                  ['÷', '×', '-', '+', '='].includes(key) && styles.operatorButton,
                  ['C', '±', '%'].includes(key) && styles.functionButton,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Text
                  style={[
                    styles.buttonText,
                    ['C', '±', '%'].includes(key) && styles.functionButtonText,
                  ]}
                >
                  {key}
                </Text>
              </Pressable>
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'flex-end',
  },
  displayWrap: {
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  display: {
    color: '#fff',
    fontSize: 80,
    fontWeight: '200',
    textAlign: 'right',
  },
  keypad: {
    paddingHorizontal: 12,
    paddingBottom: 24,
  },
  row: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  button: {
    flex: 1,
    aspectRatio: 1,
    marginHorizontal: 6,
    borderRadius: 999,
    backgroundColor: '#333',
    alignItems: 'center',
    justifyContent: 'center',
  },
  wideButton: {
    flex: 2.15,
    aspectRatio: undefined,
    alignItems: 'flex-start',
    paddingLeft: 28,
  },
  operatorButton: {
    backgroundColor: '#ff9f0a',
  },
  functionButton: {
    backgroundColor: '#a5a5a5',
  },
  buttonPressed: {
    opacity: 0.7,
  },
  buttonText: {
    color: '#fff',
    fontSize: 32,
    fontWeight: '400',
  },
  functionButtonText: {
    color: '#000',
  },
});
