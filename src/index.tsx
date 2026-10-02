import React, { useEffect, useState } from "react";
import { render, Box, Text, useInput, useApp } from "ink";

const Header = () => (
  <Box borderStyle="round" borderColor="dim" paddingX={1} marginBottom={1}>
    <Text color="green">podtui</Text>
    <Text color="dim">  Podman TUI</Text>
  </Box>
);

const Footer = () => (
  <Box marginTop={1} borderStyle="round" borderColor="dim" paddingX={1}>
    <Text color="dim">[q] quit</Text>
  </Box>
);

const Content = () => {
  const { exit } = useApp();
  const [counter, setCounter] = useState(0);

  useInput((_, key) => {
    if (key.q) {
      exit(0);
    }
  });

  useEffect(() => {
    const id = setInterval(() => setCounter((c) => c + 1), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <Box flexDirection="column" gap={1} paddingX={1} paddingY={1}>
      <Text>Hello from podtui!</Text>
      <Text color="dim">This is a feasibility spike.</Text>
      <Text>Counter: <Text color="cyan">{counter}</Text></Text>
      <Text color="dim">Press 'q' to quit.</Text>
    </Box>
  );
};

const App = () => (
  <Box flexDirection="column" height="100%">
    <Header />
    <Content />
    <Footer />
  </Box>
);

render(<App />);