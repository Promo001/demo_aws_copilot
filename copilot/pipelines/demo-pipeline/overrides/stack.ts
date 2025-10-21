import * as cdk from 'aws-cdk-lib';
import * as path from 'path';
import { aws_codepipeline as codepipeline } from 'aws-cdk-lib';

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
        this.transformPipelineTriggers();
        this.addTriggersForTagsOnly();
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

        // Enforce full clone for CodeBuild and disable default change detection.
        // Also lock to main branch to match manifest/settings.
        sourceAction.configuration = {
            ...(sourceAction.configuration || {}),
            BranchName: (sourceAction.configuration && sourceAction.configuration.BranchName) || 'main',
            DetectChanges: 'false',
            OutputArtifactFormat: 'CODEBUILD_CLONE_REF',
        };
        // Namespace not required for git-only buildspec flow
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
}