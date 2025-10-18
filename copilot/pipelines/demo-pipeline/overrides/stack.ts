import * as cdk from 'aws-cdk-lib';
import * as path from 'path';
import { aws_codestarconnections as codestarconnections, aws_codepipeline as codepipeline } from 'aws-cdk-lib';

interface TransformedStackProps extends cdk.StackProps {
    readonly appName: string;
}

export class TransformedStack extends cdk.Stack {
    public readonly template: cdk.cloudformation_include.CfnInclude;
    public readonly appName: string;

    constructor (scope: cdk.App, id: string, props: TransformedStackProps) {
        super(scope, id, props);
        this.template = new cdk.cloudformation_include.CfnInclude(this, 'Template', {
            templateFile: path.join('.build', 'in.yml'),
        });
        this.appName = props.appName;
        this.transformSourceConnection();
        this.transformPipelineTriggers();
        this.addTriggersForTagsOnly();
        this.propagateSourceVarsToBuild();
    }
    
    // TODO: implement me.
    transformSourceConnection() {
        const sourceConnection = this.template.getResource("SourceConnection") as codestarconnections.CfnConnection;
        // Configure the source connection as needed
        // This method can be used to modify connection properties if required
    }

    transformPipelineTriggers() {
        // Get the pipeline resource from the template
        const pipeline = this.template.getResource("Pipeline") as codepipeline.CfnPipeline;

        // Modify the source stage to use tag-based triggers instead of branch merges
        const stagesProp = (pipeline as any).stages;
        if (!Array.isArray(stagesProp)) {
            return;
        }
        const sourceStage = (stagesProp as any[]).find((stage: any) => stage && stage.name === 'Source');
        if (!sourceStage) {
            return;
        }
        const actionsProp = sourceStage.actions;
        if (!Array.isArray(actionsProp) || actionsProp.length === 0) {
            return;
        }
        const sourceAction = (actionsProp as any[])[0];

        // Disable default branch-based change detection and lock to main branch
        // For CodeStar Connections source actions, the supported flag is DetectChanges
        sourceAction.configuration = {
            ...(sourceAction.configuration || {}),
            BranchName: (sourceAction.configuration && sourceAction.configuration.BranchName) || 'main',
            DetectChanges: 'false',
        };
        // Expose source variables to downstream actions via a namespace
        (sourceAction as any).namespace = 'SourceVariables';
    }

    // Configure native CodePipeline triggers to run only on Git tags.
    // Per AWS docs, when using trigger filtering, DetectChanges must be disabled on the action config.
    // See: https://docs.aws.amazon.com/codepipeline/latest/userguide/pipelines-triggers.html
    addTriggersForTagsOnly() {
        const pipeline = this.template.getResource("Pipeline") as codepipeline.CfnPipeline;
        const stagesProp = (pipeline as any).stages;
        if (!Array.isArray(stagesProp)) {
            return;
        }
        const sourceStage = (stagesProp as any[]).find((stage: any) => stage && stage.name === 'Source');
        if (!sourceStage) {
            return;
        }
        const actionsProp = sourceStage.actions;
        if (!Array.isArray(actionsProp) || actionsProp.length === 0) {
            return;
        }
        const sourceAction: any = (actionsProp as any[])[0];

        // Disable default automated change detection and keep BranchName for manual runs (equivalent to triggerOnPush: false)
        sourceAction.configuration = {
            ...sourceAction.configuration,
            BranchName: sourceAction.configuration?.BranchName ?? 'main',
            DetectChanges: 'false',
        };

        // Add the Triggers override with tag/branch filters
        const sourceActionName = sourceAction.name ?? 'Source';
        pipeline.addPropertyOverride('Triggers', [
            {
                GitConfiguration: {
                    SourceActionName: sourceActionName,
                    Push: [
                        {
                            Tags: {
                                Includes: ['v*'],
                            },
                        },
                    ],
                },
                ProviderType: 'CodeStarSourceConnection',
            },
        ]);
    }

    // Ensure Build action environment variables do not reference unavailable pipeline variables.
    propagateSourceVarsToBuild() {
        const pipeline = this.template.getResource("Pipeline") as codepipeline.CfnPipeline;
        const stagesProp = (pipeline as any).stages;
        if (!Array.isArray(stagesProp)) {
            return;
        }
        const buildStage = (stagesProp as any[]).find((stage: any) => stage && stage.name === 'Build');
        if (!buildStage || !Array.isArray(buildStage.actions) || buildStage.actions.length === 0) {
            return;
        }
        const buildAction: any = buildStage.actions[0];
        const cfg = buildAction.configuration || {};

        let envs: any[] = [];
        try {
            if (cfg.EnvironmentVariables) {
                envs = JSON.parse(cfg.EnvironmentVariables);
                if (!Array.isArray(envs)) envs = [];
            }
        } catch {
            envs = [];
        }

        // Remove any variables that might reference unavailable pipeline namespaces/keys
        envs = envs.filter((e: any) => e && e.name !== 'SOURCE_REF_NAME' && e.name !== 'SOURCE_REF_TYPE');

        buildAction.configuration = {
            ...cfg,
            EnvironmentVariables: JSON.stringify(envs),
        };
    }
    
}