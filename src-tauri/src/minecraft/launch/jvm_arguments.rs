use crate::minecraft::dto::piston_meta::{ArgumentValue, ComplexArgument, GameArgument};
use crate::minecraft::rules::RuleProcessor;
use log::{info, trace};
use std::path::PathBuf;

pub struct JvmArguments {
    natives_directory: PathBuf,
    launcher_name: String,
    launcher_version: String,
    classpath: String,
}

impl JvmArguments {
    pub fn new(
        natives_directory: PathBuf,
        launcher_name: String,
        launcher_version: String,
        classpath: String,
    ) -> Self {
        Self {
            natives_directory,
            launcher_name,
            launcher_version,
            classpath,
        }
    }

    fn should_apply_argument(argument: &ComplexArgument) -> bool {
        trace!("Checking argument: {:?}", argument.value);
        RuleProcessor::should_apply_argument(&argument.rules)
    }

    fn process_argument_value(value: &ArgumentValue) -> Vec<String> {
        match value {
            ArgumentValue::Single(s) => vec![s.clone()],
            ArgumentValue::Multiple(v) => v.clone(),
        }
    }

    fn replace_variables(&self, arg: &str) -> String {
        arg.replace(
            "${natives_directory}",
            &self.natives_directory.to_string_lossy().replace("\\", "/"),
        )
        .replace("${launcher_name}", &self.launcher_name)
        .replace("${launcher_version}", &self.launcher_version)
        .replace("${classpath}", &self.classpath)
    }

    pub fn process_arguments(&self, arguments: &[GameArgument]) -> Vec<String> {
        let mut processed_args = Vec::new();

        for arg in arguments {
            match arg {
                GameArgument::Simple(s) => {
                    trace!("Processing simple argument: {}", s);
                    let processed_arg = self.replace_variables(s);
                    trace!("  After variable replacement: {}", processed_arg);
                    processed_args.push(processed_arg);
                }
                GameArgument::Complex(complex) => {
                    if Self::should_apply_argument(complex) {
                        let values = Self::process_argument_value(&complex.value);
                        for value in values {
                            let processed_arg = self.replace_variables(&value);
                            trace!("  Adding processed argument: {}", processed_arg);
                            processed_args.push(processed_arg);
                        }
                    }
                }
            }
        }

        info!("Final JVM arguments:");
        for arg in &processed_args {
            info!("  {}", arg);
        }

        processed_args
    }
}
