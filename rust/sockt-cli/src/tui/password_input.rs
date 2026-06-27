use std::io::{self, Write};
use crossterm::{
    cursor,
    event::{self, Event, KeyCode, KeyEvent, KeyModifiers},
    execute,
    style::{Color, Print, ResetColor, SetForegroundColor, Stylize},
    terminal::{self, ClearType},
};

pub struct PasswordInput {
    prompt: String,
    allow_empty: bool,
}

impl PasswordInput {
    pub fn new(prompt: &str) -> Self {
        Self {
            prompt: prompt.to_string(),
            allow_empty: false,
        }
    }

    pub fn allow_empty(mut self, allow: bool) -> Self {
        self.allow_empty = allow;
        self
    }

    pub fn interact(&self) -> io::Result<String> {
        let mut stdout = io::stdout();
        let mut input = String::new();

        // Enable raw mode for character-by-character input
        terminal::enable_raw_mode()?;

        let result = (|| {
            // Print prompt
            print!("{}", self.prompt);
            stdout.flush()?;

            // Save cursor position after prompt
            let prompt_len = self.prompt.len();

            loop {
                // Display masked input with character count
                self.render_input(&mut stdout, &input, prompt_len)?;

                // Read event
                if let Event::Key(KeyEvent { code, modifiers, .. }) = event::read()? {
                    match code {
                        KeyCode::Enter => {
                            if !input.is_empty() || self.allow_empty {
                                break;
                            }
                        }
                        KeyCode::Char('c') | KeyCode::Char('C')
                            if modifiers.contains(KeyModifiers::CONTROL) => {
                            return Err(io::Error::new(
                                io::ErrorKind::Interrupted,
                                "Interrupted by user",
                            ));
                        }
                        KeyCode::Char(c) => {
                            input.push(c);
                        }
                        KeyCode::Backspace => {
                            input.pop();
                        }
                        KeyCode::Esc => {
                            return Err(io::Error::new(
                                io::ErrorKind::Interrupted,
                                "Cancelled by user",
                            ));
                        }
                        _ => {}
                    }
                }
            }

            // Clear the line and print final state
            execute!(
                stdout,
                cursor::MoveToColumn(0),
                terminal::Clear(ClearType::CurrentLine),
            )?;

            // Reprint prompt with masked input
            print!("{}", self.prompt);
            for _ in 0..input.len() {
                print!("*");
            }
            println!();
            stdout.flush()?;

            Ok(input)
        })();

        // Disable raw mode
        terminal::disable_raw_mode()?;

        result
    }

    fn render_input(&self, stdout: &mut io::Stdout, input: &str, prompt_len: usize) -> io::Result<()> {
        // Move cursor to start of line
        execute!(stdout, cursor::MoveToColumn(0))?;

        // Clear line
        execute!(stdout, terminal::Clear(ClearType::CurrentLine))?;

        // Print prompt
        print!("{}", self.prompt);

        // Print masked characters
        for _ in 0..input.len() {
            print!("*");
        }

        // Print character count in grey
        if !input.is_empty() {
            print!(" ");
            execute!(stdout, SetForegroundColor(Color::DarkGrey))?;
            print!("[{} chars]", input.len());
            execute!(stdout, ResetColor)?;
        }

        stdout.flush()?;
        Ok(())
    }
}
