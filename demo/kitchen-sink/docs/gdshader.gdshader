shader_type spatial;
render_mode blend_mix, depth_draw_opaque, cull_back;

// Shader includes use double-quoted .gdshaderinc paths.
#include "res://shaders/common.gdshaderinc"

/**
 * Parameters in this group are exposed by ShaderMaterial.
 */
group_uniforms Surface;
uniform vec4 base_color : source_color = vec4(0.18, 0.42, 0.80, 1.0);
uniform sampler2D detail_map : source_color, filter_linear_mipmap, repeat_enable;
uniform float detail_scale : hint_range(0.5, 8.0, 0.1) = 2.0;
uniform float roughness : hint_range(0.0, 1.0, 0.01) = 0.45;
uniform float metallic : hint_range(0.0, 1.0, 0.01) = 0.1;
uniform int palette : hint_enum("Ocean", "Sunset", "Forest") = 0;
group_uniforms;

struct SurfaceData {
    vec3 albedo;
    float roughness;
};

const vec3 ACCENTS[3] = {
    vec3(0.10, 0.55, 1.00),
    vec3(1.00, 0.30, 0.10),
    vec3(0.15, 0.65, 0.30)
};

varying vec3 vertex_normal;

float wave(float offset) {
    return sin(TIME * 2.0 + offset) * 0.03;
}

void vertex() {
    VERTEX += NORMAL * wave(VERTEX.x * detail_scale);
    vertex_normal = NORMAL;
}

void fragment() {
    vec4 detail = texture(detail_map, UV * detail_scale);
    int accent_index = palette < 0 ? 0 : palette > 2 ? 2 : palette;

    SurfaceData surface = SurfaceData(
        mix(base_color.rgb, ACCENTS[accent_index], detail.r * 0.35),
        clamp(roughness + detail.g * 0.2, 0.0, 1.0)
    );

    float facing = max(dot(normalize(vertex_normal), vec3(0.0, 0.0, 1.0)), 0.0);
    ALBEDO = surface.albedo * mix(0.7, 1.0, facing);
    ROUGHNESS = surface.roughness;
    METALLIC = metallic;
}
